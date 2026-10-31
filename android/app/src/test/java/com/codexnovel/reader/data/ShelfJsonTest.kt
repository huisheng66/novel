package com.codexnovel.reader.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 用服务端 /me/shelf 的真实返回（已脱敏裁剪）验证 DTO 解码。
 * 1.1.0 的 bug：书架 progress 子对象无 novelId，而 ProgressDto.novelId 必填 → 整页崩溃。
 */
class ShelfJsonTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test
    fun `书架含进度时正常解码`() {
        val payload = """
            {"items":[{
              "novelId":9,"title":"蛊真人","author":"蛊真人","coverUrl":"",
              "status":"serializing","lastChapterNumber":2284,
              "lastChapterTitle":"第三百一十七节：三尊图谋幽魂",
              "novelUpdatedAt":"2026-08-08T23:40:22.000Z",
              "addedAt":"2026-10-31T03:48:40.000Z","lastOpenedAt":null,
              "progress":{"chapterNumber":43,"offsetRatio":1,
                          "updatedAt":"2026-10-31T03:48:22.000Z"},
              "hasUpdate":true
            }]}
        """.trimIndent()

        val resp = json.decodeFromString<ShelfResponse>(payload)
        val item = resp.items.single()
        assertEquals(9, item.novelId)
        assertEquals(2284, item.lastChapterNumber)
        assertEquals(43, item.progress?.chapterNumber)
        assertEquals(1.0, item.progress?.offsetRatio)
    }

    @Test
    fun `书架无进度时 progress 为 null`() {
        val payload = """{"items":[{"novelId":9,"title":"x","progress":null,"hasUpdate":false}]}"""
        val resp = json.decodeFromString<ShelfResponse>(payload)
        assertEquals(null, resp.items.single().progress)
    }

    @Test
    fun `progress 缺失整个字段也不崩（走默认值）`() {
        val payload = """{"items":[{"novelId":9,"title":"x","hasUpdate":false}]}"""
        val resp = json.decodeFromString<ShelfResponse>(payload)
        assertEquals(null, resp.items.single().progress)
    }

    @Test
    fun `1_1_0 版本的同形状 JSON 在旧模型下必然失败（回归哨兵）`() {
        // 哨兵：确认 ProgressDto 对「无 novelId 的 progress 子对象」是可解码的。
        // 如果未来有人把 novelId 改回必填，这个测试会失败并阻止书架页再次崩溃。
        val progressOnly = """{"chapterNumber":43,"offsetRatio":1,"updatedAt":"2026-10-31T03:48:22.000Z"}"""
        val dto = json.decodeFromString<ProgressDto>(progressOnly)
        assertEquals(43, dto.chapterNumber)
        assertEquals("缺失的 novelId 应回退默认值 0", 0, dto.novelId)
    }
}
