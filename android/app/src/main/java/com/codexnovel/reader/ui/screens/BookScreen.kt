package com.codexnovel.reader.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.clickable
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.codexnovel.reader.Graph
import com.codexnovel.reader.data.ApiException
import com.codexnovel.reader.data.Book
import com.codexnovel.reader.data.TocItem
import com.codexnovel.reader.data.TocResponse
import com.codexnovel.reader.ui.ErrorBox
import com.codexnovel.reader.ui.LoadingBox
import com.codexnovel.reader.ui.theme.money
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

@Composable
fun BookScreen(bookId: Int, onRead: (Int, Int) -> Unit) {
    var book by remember { mutableStateOf<Book?>(null) }
    var toc by remember { mutableStateOf<TocResponse?>(null) }
    var chapters by remember { mutableStateOf<List<TocItem>>(emptyList()) }
    var inShelf by remember { mutableStateOf(false) }
    var startChapter by remember { mutableStateOf(1) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        loading = true
        error = null
        try {
            // 详情 / 目录 / 书架状态三个请求并行，串行时是三者之和
            coroutineScope {
                val bookDef = async { runCatching { Graph.repo.book(bookId) } }
                val tocDef = async { runCatching { Graph.repo.toc(bookId, 1, 200) } }
                val shelfDef = async { runCatching { Graph.repo.shelf().any { it.novelId == bookId } } }

                book = bookDef.await().getOrNull()
                val catalog = tocDef.await().getOrNull()
                toc = catalog
                chapters = catalog?.items ?: emptyList()
                inShelf = shelfDef.await().getOrDefault(false)

                if (book == null || catalog == null) error = "加载失败，请重试"
            }

            val local = Graph.prefs.localProgress(bookId)
            startChapter = local?.chapterNumber?.takeIf { it > 0 } ?: 1
        } catch (err: ApiException) {
            error = err.message
        } catch (err: Exception) {
            error = err.message ?: "网络异常"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(bookId) { load() }

    when {
        loading -> LoadingBox()
        error != null -> ErrorBox(error!!) { scope.launch { load() } }
        book == null -> ErrorBox("书籍不存在")
        else -> {
            val detail = book!!
            Column(modifier = Modifier.fillMaxSize()) {
                Row(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                    if (detail.coverUrl.isNotBlank()) {
                        AsyncImage(
                            model = detail.coverUrl,
                            contentDescription = detail.title,
                            modifier = Modifier.size(width = 72.dp, height = 96.dp)
                        )
                    }
                    Column(modifier = Modifier.padding(start = 12.dp)) {
                        Text(detail.title, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = "${detail.author.ifBlank { "佚名" }} · ${detail.chapterCount} 章",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (detail.lastChapterTitle.isNotBlank()) {
                            Text(
                                text = "最新：${detail.lastChapterTitle}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }

                if (detail.description.isNotBlank()) {
                    Text(
                        text = detail.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp),
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = { onRead(bookId, startChapter) },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(if (startChapter > 1) "继续阅读 · 第 $startChapter 章" else "开始阅读")
                    }

                    OutlinedButton(onClick = {
                        scope.launch {
                            runCatching {
                                if (inShelf) Graph.repo.removeShelf(bookId) else Graph.repo.addShelf(bookId)
                            }.onSuccess { inShelf = !inShelf }
                        }
                    }) {
                        Text(if (inShelf) "移出书架" else "加入书架")
                    }
                }

                Text(
                    text = "目录（共 ${toc?.total ?: chapters.size} 章）",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )

                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(chapters, key = { it.chapterNumber }) { chapter ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onRead(bookId, chapter.chapterNumber) }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = String.format("%04d", chapter.chapterNumber),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(end = 10.dp)
                            )
                            Text(
                                text = chapter.title,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            if (!chapter.isFree) {
                                Text(
                                    text = if (chapter.price > 0) "¥${money(chapter.price)}" else "付费",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        }
    }
}
