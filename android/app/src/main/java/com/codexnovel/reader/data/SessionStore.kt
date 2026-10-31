package com.codexnovel.reader.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json

private val Context.sessionDataStore by preferencesDataStore(name = "session")

/**
 * 登录态：内存里保留当前 token（供 OkHttp 拦截器同步读取），
 * 同时落 DataStore，重启后免登录。
 */
class SessionStore(private val context: Context, private val json: Json) {

    private val keyAuth = stringPreferencesKey("auth")
    private val keyUser = stringPreferencesKey("user")

    private val _auth = MutableStateFlow<AuthResponse?>(null)
    private val _user = MutableStateFlow<User?>(null)

    val user: StateFlow<User?> = _user

    fun accessToken(): String? = _auth.value?.accessToken
    fun refreshToken(): String? = _auth.value?.refreshToken
    fun isLoggedIn(): Boolean = accessToken() != null || refreshToken() != null

    suspend fun load() {
        val prefs = context.sessionDataStore.data.first()

        prefs[keyAuth]?.let { raw ->
            runCatching { json.decodeFromString<AuthResponse>(raw) }
                .onSuccess { _auth.value = it; _user.value = it.user }
        }

        // 用户信息可能被单独更新（比如邮箱验证后）
        if (_user.value == null) {
            prefs[keyUser]?.let { raw ->
                runCatching { json.decodeFromString<User>(raw) }.onSuccess { _user.value = it }
            }
        }
    }

    suspend fun save(auth: AuthResponse) {
        _auth.value = auth
        _user.value = auth.user
        context.sessionDataStore.edit { prefs ->
            prefs[keyAuth] = json.encodeToString(AuthResponse.serializer(), auth)
            prefs[keyUser] = json.encodeToString(User.serializer(), auth.user)
        }
    }

    /** 刷新只换 token，用户信息保持不变 */
    suspend fun saveTokens(accessToken: String, refreshToken: String) {
        val current = _auth.value
        val next = AuthResponse(
            user = current?.user ?: _user.value ?: User(id = 0, username = ""),
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresIn = current?.expiresIn ?: 0
        )
        _auth.value = next
        context.sessionDataStore.edit { prefs ->
            prefs[keyAuth] = json.encodeToString(AuthResponse.serializer(), next)
        }
    }

    suspend fun updateUser(user: User) {
        _user.value = user
        context.sessionDataStore.edit { prefs ->
            prefs[keyUser] = json.encodeToString(User.serializer(), user)
        }
    }

    suspend fun clear() {
        _auth.value = null
        _user.value = null
        context.sessionDataStore.edit { prefs ->
            prefs.remove(keyAuth)
            prefs.remove(keyUser)
        }
    }
}
