package com.codexnovel.reader.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.codexnovel.reader.Graph
import com.codexnovel.reader.data.ApiException
import com.codexnovel.reader.data.ChapterResponse
import com.codexnovel.reader.data.ProgressDto
import com.codexnovel.reader.ui.ErrorBox
import com.codexnovel.reader.ui.LoadingBox
import com.codexnovel.reader.ui.theme.money
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderScreen(
    bookId: Int,
    chapterNumber: Int,
    onBack: () -> Unit,
    onOpenBook: (Int) -> Unit,
    onOpenWallet: () -> Unit,
    onGoChapter: (Int) -> Unit
) {
    var chapter by remember { mutableStateOf<ChapterResponse?>(null) }
    var paywall by remember { mutableStateOf<ApiException?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableIntStateOf(0) }

    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val fontSize by Graph.prefs.fontSize.collectAsState()
    val theme by Graph.prefs.theme.collectAsState()

    LaunchedEffect(bookId, chapterNumber, reloadKey) {
        loading = true
        chapter = null
        paywall = null
        message = null

        // 1) 磁盘缓存优先：读过的章节秒开（弱网/断网也能读）
        val cached = Graph.prefs.cachedChapter(bookId, chapterNumber)
        if (cached != null) {
            chapter = cached
            loading = false
        }

        // 2) 网络刷新 + 预取相邻章节
        try {
            val fresh = Graph.repo.chapter(bookId, chapterNumber)
            chapter = fresh
            Graph.prefs.saveChapterCache(fresh)
            loading = false

            // 预取上一/下一章：翻页时大概率命中磁盘缓存
            for (neighbor in listOfNotNull(fresh.prev, fresh.next)) {
                launch {
                    runCatching {
                        Graph.repo.chapter(bookId, neighbor).let { Graph.prefs.saveChapterCache(it) }
                    }
                }
            }
        } catch (err: ApiException) {
            if (err.isPaymentRequired) {
                paywall = err
                loading = false
            } else if (cached == null) {
                message = err.message
                loading = false
            }
            // 有缓存时网络失败不打断阅读：保持缓存内容
        } catch (err: Exception) {
            if (cached == null) {
                message = err.message ?: "网络异常"
                loading = false
            }
        }
    }

    // 恢复进度：等布局完成（maxValue > 0）再按比例跳转；短章节直接从头读
    LaunchedEffect(chapter) {
        if (chapter == null) return@LaunchedEffect

        val max = withTimeoutOrNull(1000) {
            snapshotFlow { scroll.maxValue }.first { it > 0 }
        } ?: 0
        if (max <= 0) return@LaunchedEffect

        val local = Graph.prefs.localProgress(bookId)
        var ratio = if (local?.chapterNumber == chapterNumber) local.offsetRatio else 0.0

        val remote = runCatching { Graph.repo.remoteProgress(bookId) }.getOrNull()
        if (remote != null && remote.chapterNumber == chapterNumber) {
            val remoteAt = remote.updatedAt ?: ""
            val localAt = local?.updatedAt ?: ""
            // 与服务端 LWW 一致：云端更新就采用云端
            if (local == null || remoteAt >= localAt) ratio = remote.offsetRatio
        }

        if (ratio > 0) scroll.scrollTo((max * ratio).toInt()) else scroll.scrollTo(0)
    }

    // 进度：本地立即存，云端延迟 800ms 再推（collectLatest 天然防抖）
    LaunchedEffect(chapter) {
        if (chapter == null) return@LaunchedEffect

        snapshotFlow {
            if (scroll.maxValue > 0) scroll.value.toFloat() / scroll.maxValue else 0f
        }.collectLatest { ratio ->
            Graph.prefs.saveLocalProgress(
                ProgressDto(
                    novelId = bookId,
                    chapterNumber = chapterNumber,
                    offsetRatio = ratio.toDouble()
                )
            )

            delay(800)
            runCatching {
                Graph.repo.pushProgress(
                    ProgressDto(
                        novelId = bookId,
                        chapterNumber = chapterNumber,
                        offsetRatio = ratio.toDouble(),
                        updatedAt = Instant.now().toString(),
                        deviceName = "android"
                    )
                )
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = chapter?.title ?: "第 $chapterNumber 章",
                        style = MaterialTheme.typography.titleSmall
                    )
                },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("返回") }
                },
                actions = {
                    TextButton(onClick = { onOpenBook(bookId) }) { Text("目录") }
                }
            )
        },
        bottomBar = {
            Column {
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(onClick = {
                        scope.launch { Graph.prefs.setFontSize(Graph.prefs.fontSize.value - 1) }
                    }) { Text("A-") }

                    OutlinedButton(onClick = {
                        scope.launch { Graph.prefs.setFontSize(Graph.prefs.fontSize.value + 1) }
                    }) { Text("A+") }

                    OutlinedButton(onClick = {
                        val order = listOf("auto", "light", "dark", "sepia")
                        val next = order[(order.indexOf(theme).coerceAtLeast(0) + 1) % order.size]
                        scope.launch { Graph.prefs.setTheme(next) }
                    }) { Text("主题") }

                    Text(
                        text = when (theme) {
                            "dark" -> "深色"
                            "sepia" -> "护眼"
                            "light" -> "浅色"
                            else -> "跟随系统"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 14.dp)
                    )
                }
            }
        }
    ) { innerPadding ->
        Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            when {
                loading -> LoadingBox()
                message != null -> ErrorBox(message!!) { reloadKey += 1 }
                paywall != null -> PaywallPane(
                    error = paywall!!,
                    busy = busy,
                    message = message,
                    onBuy = {
                        scope.launch {
                            busy = true
                            message = null
                            try {
                                val result = Graph.repo.purchase(bookId, chapterNumber)
                                message = if (result.alreadyOwned) {
                                    "该章已购买，正在打开"
                                } else {
                                    "购买成功，扣除 ¥${money(result.amount)}，余额 ¥${money(result.balance)}"
                                }
                                reloadKey += 1
                            } catch (err: ApiException) {
                                message = if (err.isInsufficientBalance) {
                                    "余额不足，请先到「我的」充值"
                                } else {
                                    err.message
                                }
                            } catch (err: Exception) {
                                message = err.message ?: "购买失败"
                            } finally {
                                busy = false
                            }
                        }
                    },
                    onOpenWallet = onOpenWallet
                )
                chapter != null -> {
                    val data = chapter!!
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(scroll)
                            .padding(horizontal = 20.dp, vertical = 12.dp)
                    ) {
                        Text(
                            text = data.title,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(bottom = 14.dp)
                        )

                        val paragraphStyle = TextStyle(
                            fontSize = fontSize.sp,
                            lineHeight = (fontSize * 1.8).sp,
                            color = MaterialTheme.colorScheme.onBackground
                        )

                        val paragraphs = if (data.paragraphs.isNotEmpty()) {
                            data.paragraphs
                        } else {
                            data.content.split("\n").filter { it.isNotBlank() }
                        }

                        for (paragraph in paragraphs) {
                            Text(
                                text = paragraph,
                                style = paragraphStyle,
                                modifier = Modifier.padding(bottom = 12.dp)
                            )
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            if (data.prev != null) {
                                OutlinedButton(
                                    onClick = { data.prev?.let(onGoChapter) },
                                    modifier = Modifier.weight(1f)
                                ) { Text("上一章") }
                            }
                            if (data.next != null) {
                                Button(
                                    onClick = { data.next?.let(onGoChapter) },
                                    modifier = Modifier.weight(1f)
                                ) { Text("下一章") }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PaywallPane(
    error: ApiException,
    busy: Boolean,
    message: String?,
    onBuy: () -> Unit,
    onOpenWallet: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("本章为付费章节", style = MaterialTheme.typography.titleMedium)

        error.teaser?.takeIf { it.isNotBlank() }?.let { teaser ->
            Text(
                text = teaser,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 6
            )
        }

        Text(
            text = if ((error.price ?: 0) > 0) "¥${money(error.price!!)}" else "需解锁",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.primary
        )

        Button(onClick = onBuy, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text(if (busy) "处理中…" else "购买本章")
        }

        TextButton(onClick = onOpenWallet, modifier = Modifier.fillMaxWidth()) {
            Text("查看余额与充值")
        }

        message?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}
