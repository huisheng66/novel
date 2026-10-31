package com.codexnovel.reader.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {

    /* 认证 */
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponse

    @POST("auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponse

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): AuthResponse

    @GET("me")
    suspend fun me(): MeResponse

    /* 书库 */
    @GET("books")
    suspend fun books(
        @Query("q") q: String?,
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int
    ): BookListResponse

    @GET("books/{id}")
    suspend fun book(@Path("id") id: Int): Book

    @GET("books/{id}/toc")
    suspend fun toc(
        @Path("id") id: Int,
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int
    ): TocResponse

    @GET("books/{id}/chapters/{number}")
    suspend fun chapter(
        @Path("id") id: Int,
        @Path("number") number: Int
    ): ChapterResponse

    /* 书架 */
    @GET("me/shelf")
    suspend fun shelf(): ShelfResponse

    @POST("me/shelf")
    suspend fun addShelf(@Body body: ShelfAddRequest): Response<Unit>

    @DELETE("me/shelf/{id}")
    suspend fun removeShelf(@Path("id") id: Int): Response<Unit>

    /* 进度 */
    @GET("me/progress/{id}")
    suspend fun progress(@Path("id") id: Int): ProgressDto

    @PUT("me/progress")
    suspend fun putProgress(@Body body: ProgressDto): ProgressPutResponse

    /* 钱包与购买 */
    @GET("me/wallet")
    suspend fun wallet(): WalletResponse

    @POST("me/wallet/redeem")
    suspend fun redeem(@Body body: RedeemRequest): RedeemResponse

    @POST("me/purchases")
    suspend fun purchase(@Body body: PurchaseRequest): PurchaseResponse

    @GET("me/purchases")
    suspend fun purchases(): PurchaseListResponse
}
