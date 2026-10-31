package com.codexnovel.reader

import android.content.Context
import com.codexnovel.reader.data.Network
import com.codexnovel.reader.data.PrefsStore
import com.codexnovel.reader.data.Repository
import com.codexnovel.reader.data.SessionStore
import com.codexnovel.reader.data.defaultJson

/**
 * 极简依赖容器：这个规模用 Hilt 反而增加理解成本。
 */
object Graph {

    private val json by lazy { defaultJson() }

    lateinit var session: SessionStore
        private set
    lateinit var prefs: PrefsStore
        private set
    lateinit var repo: Repository
        private set

    fun init(context: Context) {
        if (::repo.isInitialized) return

        val app = context.applicationContext
        session = SessionStore(app, json)
        prefs = PrefsStore(app, json)

        val baseUrl = BuildConfig.API_BASE_URL
        val authed = Network.authedClient(session)
        val plain = Network.plainClient()

        val alternates = BuildConfig.API_FALLBACK_URLS
            .split(";")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .map { Network.service(it, authed, json) }

        repo = Repository(
            api = Network.service(baseUrl, authed, json),
            plainApi = Network.service(baseUrl, plain, json),
            session = session,
            json = json,
            alternates = alternates
        )
    }
}
