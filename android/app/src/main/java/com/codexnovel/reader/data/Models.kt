package com.codexnovel.reader.data

import kotlinx.serialization.Serializable

/* ===== 认证 ===== */

@Serializable
data class LoginRequest(
    val login: String,
    val password: String,
    val deviceName: String? = null
)

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val displayName: String? = null,
    val inviteCode: String? = null
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class AuthResponse(
    val user: User,
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int = 0,
    val emailVerificationSent: Boolean = false
)

@Serializable
data class User(
    val id: Int,
    val username: String,
    val displayName: String? = null,
    val email: String? = null,
    val emailVerified: Boolean = false
)

@Serializable
data class MeResponse(val user: User)

/* ===== 书库 ===== */

@Serializable
data class BookListResponse(
    val page: Int = 1,
    val pageSize: Int = 20,
    val total: Int = 0,
    val items: List<Book> = emptyList()
)

@Serializable
data class Book(
    val id: Int,
    val title: String,
    val author: String = "",
    val description: String = "",
    val coverUrl: String = "",
    val status: String = "serializing",
    val chapterCount: Int = 0,
    val lastChapterNumber: Int? = null,
    val lastChapterTitle: String = "",
    val updatedAt: String? = null
)

@Serializable
data class PaywallInfo(val freeUntilChapter: Int? = null)

@Serializable
data class TocItem(
    val id: Int = 0,
    val chapterNumber: Int,
    val title: String,
    val updatedAt: String? = null,
    val isFree: Boolean = true,
    val price: Int = 0
)

@Serializable
data class TocResponse(
    val novelId: Int,
    val page: Int = 1,
    val pageSize: Int = 100,
    val total: Int = 0,
    val totalPages: Int = 1,
    val paywall: PaywallInfo? = null,
    val items: List<TocItem> = emptyList()
)

@Serializable
data class ChapterResponse(
    val novelId: Int,
    val chapterId: Int = 0,
    val chapterNumber: Int,
    val title: String,
    val content: String = "",
    val paragraphs: List<String> = emptyList(),
    val contentHash: String = "",
    val updatedAt: String? = null,
    val prev: Int? = null,
    val next: Int? = null
)

/* ===== 书架 / 进度 ===== */

@Serializable
data class ShelfItem(
    val novelId: Int,
    val title: String,
    val author: String = "",
    val coverUrl: String = "",
    val status: String = "",
    val lastChapterNumber: Int? = null,
    val lastChapterTitle: String = "",
    val hasUpdate: Boolean = false,
    val progress: ProgressDto? = null
)

@Serializable
data class ShelfResponse(val items: List<ShelfItem> = emptyList())

@Serializable
data class ShelfAddRequest(val novelId: Int)

/**
 * 进度 DTO。
 * 注意：书架接口返回的 progress 子对象只有 chapterNumber/offsetRatio/updatedAt（无 novelId），
 * 因此除 chapterId 外全部带默认值——新增字段时务必给默认，否则书架页反序列化直接崩。
 * 上报（PUT /me/progress）时调用方必须显式填 novelId 与 chapterNumber，服务端会校验。
 */
@Serializable
data class ProgressDto(
    val novelId: Int = 0,
    val chapterNumber: Int = 0,
    val chapterId: Int? = null,
    val offsetRatio: Double = 0.0,
    val updatedAt: String? = null,
    val deviceName: String? = null
)

@Serializable
data class ProgressPutResponse(
    val applied: Boolean = false,
    val progress: ProgressDto? = null
)

/* ===== 钱包 / 购买 ===== */

@Serializable
data class WalletResponse(
    val balance: Int = 0,
    val updatedAt: String? = null,
    val transactions: List<WalletTransaction> = emptyList()
)

@Serializable
data class WalletTransaction(
    val id: Long,
    val delta: Int,
    val balanceAfter: Int = 0,
    val type: String = "",
    val note: String? = null,
    val createdAt: String = ""
)

@Serializable
data class RedeemRequest(val code: String)

@Serializable
data class RedeemResponse(val amount: Int = 0, val balance: Int = 0)

@Serializable
data class PurchaseRequest(val novelId: Int, val chapterNumber: Int)

@Serializable
data class PurchaseResponse(
    val novelId: Int,
    val chapterNumber: Int,
    val alreadyOwned: Boolean = false,
    val amount: Int = 0,
    val balance: Int = 0
)

@Serializable
data class PurchaseItem(
    val novelId: Int,
    val chapterNumber: Int,
    val amount: Int = 0,
    val purchasedAt: String? = null
)

@Serializable
data class PurchaseListResponse(val items: List<PurchaseItem> = emptyList())

/* ===== 错误 ===== */

@Serializable
data class ApiErrorBody(
    val code: String = "",
    val message: String = "",
    val price: Int? = null,
    val teaser: String? = null,
    val required: Int? = null,
    val balance: Int? = null
)

@Serializable
data class ApiErrorEnvelope(val error: ApiErrorBody? = null)
