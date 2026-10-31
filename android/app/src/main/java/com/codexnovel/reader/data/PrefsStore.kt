package com.codexnovel.reader.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Instant

private val Context.prefsDataStore by preferencesDataStore(name = "prefs")

/**
 * 阅读偏好与本地进度。
 * 进度按书存一份，云端那份由服务端 LWW 合并；这里只负责「离线也能续读」。
 */
class PrefsStore(private val context: Context, private val json: Json) {

    private val keyTheme = stringPreferencesKey("theme")       // auto | light | dark | sepia
    private val keyFontSize = intPreferencesKey("fontSize")    // sp
    private fun keyProgress(novelId: Int) = stringPreferencesKey("progress_$novelId")

    private val _theme = MutableStateFlow("auto")
    private val _fontSize = MutableStateFlow(18)

    val theme: StateFlow<String> = _theme
    val fontSize: StateFlow<Int> = _fontSize

    suspend fun load() {
        val prefs = context.prefsDataStore.data.first()
        _theme.value = prefs[keyTheme] ?: "auto"
        _fontSize.value = prefs[keyFontSize] ?: 18
    }

    suspend fun setTheme(value: String) {
        _theme.value = value
        context.prefsDataStore.edit { it[keyTheme] = value }
    }

    suspend fun setFontSize(value: Int) {
        val size = value.coerceIn(14, 28)
        _fontSize.value = size
        context.prefsDataStore.edit { it[keyFontSize] = size }
    }

    suspend fun localProgress(novelId: Int): ProgressDto? {
        val prefs = context.prefsDataStore.data.first()
        return prefs[keyProgress(novelId)]?.let { raw ->
            runCatching { json.decodeFromString<ProgressDto>(raw) }.getOrNull()
        }
    }

    suspend fun saveLocalProgress(progress: ProgressDto) {
        val stamped = progress.copy(updatedAt = Instant.now().toString(), deviceName = "android")
        context.prefsDataStore.edit {
            it[keyProgress(progress.novelId)] = json.encodeToString(ProgressDto.serializer(), stamped)
        }
    }

    /* ===== 章节磁盘缓存：读过的章 saves 重开秒出 ===== */

    private fun chapterFile(novelId: Int, number: Int) =
        File(File(context.cacheDir, "chapters"), "${novelId}_${number}.json")

    suspend fun cachedChapter(novelId: Int, number: Int): ChapterResponse? =
        withContext(Dispatchers.IO) {
            val file = chapterFile(novelId, number)
            if (!file.exists()) return@withContext null
            runCatching { json.decodeFromString<ChapterResponse>(file.readText()) }.getOrNull()
        }

    suspend fun saveChapterCache(chapter: ChapterResponse) = withContext(Dispatchers.IO) {
        runCatching {
            val dir = File(context.cacheDir, "chapters").apply { mkdirs() }
            chapterFile(chapter.novelId, chapter.chapterNumber)
                .writeText(json.encodeToString(ChapterResponse.serializer(), chapter))
        }
    }

    /* ===== 书库列表缓存：打开 App 秒进书库，后台再刷新 ===== */

    suspend fun cachedLibrary(): List<Book> = withContext(Dispatchers.IO) {
        val file = File(context.cacheDir, "library_cache.json")
        if (!file.exists()) return@withContext emptyList()
        runCatching { json.decodeFromString<List<Book>>(file.readText()) }.getOrDefault(emptyList())
    }

    suspend fun saveLibraryCache(items: List<Book>) = withContext(Dispatchers.IO) {
        runCatching {
            File(context.cacheDir, "library_cache.json")
                .writeText(json.encodeToString<List<Book>>(items))
        }
    }
}
