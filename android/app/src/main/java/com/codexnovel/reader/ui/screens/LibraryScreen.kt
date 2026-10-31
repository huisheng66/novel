package com.codexnovel.reader.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.codexnovel.reader.Graph
import com.codexnovel.reader.data.Book
import com.codexnovel.reader.data.ApiException
import com.codexnovel.reader.data.ShelfItem
import com.codexnovel.reader.ui.BookRow
import com.codexnovel.reader.ui.ErrorBox
import com.codexnovel.reader.ui.LoadingBox
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun LibraryScreen(onOpenBook: (Int) -> Unit) {
    var query by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<Book>>(emptyList()) }
    var page by remember { mutableIntStateOf(1) }
    var total by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    // 先展示上次的书单：打开 App 秒进，随后后台刷新
    LaunchedEffect(Unit) {
        val cached = Graph.prefs.cachedLibrary()
        if (cached.isNotEmpty() && items.isEmpty()) {
            items = cached
            total = cached.size
            loading = false
        }
    }


    suspend fun load(reset: Boolean) {
        loading = true
        error = null
        try {
            val current = if (reset) 1 else page + 1
            val data = Graph.repo.books(query, current, 20)
            items = if (reset) data.items else items + data.items
            page = current
            total = data.total
            if (reset && query.isBlank()) Graph.prefs.saveLibraryCache(data.items)
        } catch (err: ApiException) {
            error = err.message
        } catch (err: Exception) {
            error = err.message ?: "网络异常"
        } finally {
            loading = false
        }
    }

    // 搜索防抖：query 变化 300ms 后才请求（首次进入也会触发一次）
    LaunchedEffect(query) {
        delay(300)
        load(true)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("搜索书名或作者") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
        )

        when {
            loading && items.isEmpty() -> LoadingBox()
            error != null && items.isEmpty() -> ErrorBox(error!!) { scope.launch { load(true) } }
            items.isEmpty() -> ErrorBox("没有找到匹配的书")
            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(items, key = { it.id }) { book ->
                    BookRow(
                        title = book.title,
                        subtitle = "${book.author.ifBlank { "佚名" }} · 共 ${book.chapterCount} 章",
                        coverUrl = book.coverUrl,
                        onClick = { onOpenBook(book.id) },
                        trailing = book.lastChapterTitle.ifBlank { null }
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }

                item {
                    if (items.size < total) {
                        TextButton(
                            onClick = { scope.launch { load(false) } },
                            enabled = !loading,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (loading) "加载中…" else "加载更多（${items.size}/$total）")
                        }
                    } else {
                        Text(
                            text = "共 $total 本",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ShelfScreen(onOpenBook: (Int) -> Unit, onRead: (Int, Int) -> Unit) {
    var items by remember { mutableStateOf<List<ShelfItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        loading = true
        error = null
        try {
            items = Graph.repo.shelf()
        } catch (err: ApiException) {
            error = err.message
        } catch (err: Exception) {
            error = err.message ?: "网络异常"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    when {
        loading -> LoadingBox()
        error != null -> ErrorBox(error!!) { scope.launch { load() } }
        items.isEmpty() -> ErrorBox("书架还是空的，去书库挑一本")
        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(items, key = { it.novelId }) { item ->
                val progress = item.progress
                BookRow(
                    title = item.title,
                    subtitle = if (progress != null) "读到第 ${progress.chapterNumber} 章" else "尚未开始",
                    coverUrl = item.coverUrl,
                    onClick = {
                        if (progress != null) onRead(item.novelId, progress.chapterNumber)
                        else onOpenBook(item.novelId)
                    },
                    trailing = if (item.hasUpdate) "有更新" else item.lastChapterTitle.ifBlank { null }
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}
