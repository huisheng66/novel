package com.codexnovel.reader.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/** 业务错误：把后端的 { error: { code, message, price, teaser } } 摊平成异常 */
class ApiException(
    val status: Int,
    val code: String?,
    message: String,
    val price: Int? = null,
    val teaser: String? = null
) : Exception(message) {
    val isPaymentRequired get() = code == "PAYMENT_REQUIRED" || status == 402
    val isInsufficientBalance get() = code == "INSUFFICIENT_BALANCE"
    val isEmailNotVerified get() = code == "EMAIL_NOT_VERIFIED"
}

class Repository(
    private val api: ApiService,
    private val plainApi: ApiService,
    private val session: SessionStore,
    private val json: Json,
    /** 备用线路：主线路网络失败时按序回退（如直连源站 IP，绕过 Cloudflare） */
    private val alternates: List<ApiService> = emptyList()
) {
    private val refreshMutex = Mutex()

    private fun toApiException(err: HttpException): ApiException {
        val raw = runCatching { err.response()?.errorBody()?.string() }.getOrNull()
        val body = raw?.let {
            runCatching { json.decodeFromString<ApiErrorEnvelope>(it) }.getOrNull()
        }?.error

        return ApiException(
            status = err.code(),
            code = body?.code,
            message = body?.message?.takeIf { it.isNotBlank() } ?: "请求失败（${err.code()}）",
            price = body?.price,
            teaser = body?.teaser
        )
    }

    private suspend fun <T> onService(svc: ApiService, allowRefresh: Boolean, block: suspend ApiService.() -> T): T {
        return try {
            block(svc)
        } catch (err: HttpException) {
            if (allowRefresh && err.code() == 401 && session.refreshToken() != null && refreshTokens()) {
                onService(svc, allowRefresh = false, block = block)
            } else {
                throw toApiException(err)
            }
        }
    }

    /**
     * 统一入口：先走主线路；**只有网络层失败**（超时/连不上）才按序切备用线路。
     * 服务端有响应的错误（402 付费、404 等）不切线路——那是业务状态，换线路也改变不了。
     */
    private suspend fun <T> call(block: suspend ApiService.() -> T): T {
        var lastError: Exception? = null

        try {
            return onService(api, allowRefresh = true, block = block)
        } catch (err: CancellationException) {
            throw err
        } catch (err: ApiException) {
            throw err
        } catch (err: Exception) {
            if (alternates.isEmpty()) throw err
            lastError = err
        }

        for (svc in alternates) {
            try {
                return onService(svc, allowRefresh = true, block = block)
            } catch (err: CancellationException) {
                throw err
            } catch (err: ApiException) {
                throw err
            } catch (err: Exception) {
                lastError = err
            }
        }

        throw lastError ?: IllegalStateException("所有线路均不可用")
    }

    private suspend fun refreshTokens(): Boolean = refreshMutex.withLock {
        val token = session.refreshToken() ?: return false

        runCatching { plainApi.refresh(RefreshRequest(token)) }
            .onSuccess { session.saveTokens(it.accessToken, it.refreshToken) }
            .isSuccess
    }

    /* ---- 认证 ---- */

    suspend fun login(login: String, password: String): AuthResponse {
        val result = try {
            api.login(LoginRequest(login = login, password = password, deviceName = "android"))
        } catch (err: HttpException) {
            throw toApiException(err)
        }
        session.save(result)
        return result
    }

    suspend fun register(email: String, password: String, inviteCode: String?): AuthResponse {
        val result = try {
            api.register(
                RegisterRequest(
                    email = email,
                    password = password,
                    inviteCode = inviteCode?.takeIf { it.isNotBlank() }
                )
            )
        } catch (err: HttpException) {
            throw toApiException(err)
        }
        session.save(result)
        return result
    }

    suspend fun me(): User = call { me().user }

    /* ---- 书库 ---- */

    suspend fun books(q: String, page: Int, pageSize: Int = 20): BookListResponse =
        call { books(q.takeIf { it.isNotBlank() }, page, pageSize) }

    suspend fun book(id: Int): Book = call { book(id) }

    suspend fun toc(id: Int, page: Int = 1, pageSize: Int = 200): TocResponse =
        call { toc(id, page, pageSize) }

    suspend fun chapter(id: Int, number: Int): ChapterResponse = call { chapter(id, number) }

    /* ---- 书架 ---- */

    suspend fun shelf(): List<ShelfItem> = call { shelf().items }

    suspend fun addShelf(novelId: Int) {
        call { addShelf(ShelfAddRequest(novelId)) }
    }

    suspend fun removeShelf(novelId: Int) {
        call { removeShelf(novelId) }
    }

    /* ---- 进度 ---- */

    suspend fun remoteProgress(novelId: Int): ProgressDto? = try {
        call { progress(novelId) }
    } catch (err: ApiException) {
        if (err.status == 404) null else throw err
    }

    suspend fun pushProgress(progress: ProgressDto) {
        call { putProgress(progress) }
    }

    /* ---- 钱包 ---- */

    suspend fun wallet(): WalletResponse = call { wallet() }

    suspend fun redeem(code: String): RedeemResponse = call { redeem(RedeemRequest(code)) }

    suspend fun purchase(novelId: Int, chapterNumber: Int): PurchaseResponse =
        call { purchase(PurchaseRequest(novelId, chapterNumber)) }

    suspend fun purchases(): List<PurchaseItem> = call { purchases().items }
}
