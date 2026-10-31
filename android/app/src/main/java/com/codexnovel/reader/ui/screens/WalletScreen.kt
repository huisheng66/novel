package com.codexnovel.reader.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.codexnovel.reader.Graph
import com.codexnovel.reader.data.ApiException
import com.codexnovel.reader.data.PurchaseItem
import com.codexnovel.reader.data.WalletResponse
import com.codexnovel.reader.data.WalletTransaction
import com.codexnovel.reader.ui.ErrorBox
import com.codexnovel.reader.ui.SectionCard
import com.codexnovel.reader.ui.theme.money
import kotlinx.coroutines.launch

@Composable
fun WalletScreen(
    onLoggedOut: () -> Unit,
    onOpenChapter: (Int, Int) -> Unit
) {
    var wallet by remember { mutableStateOf<WalletResponse?>(null) }
    var purchases by remember { mutableStateOf<List<PurchaseItem>>(emptyList()) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val user by Graph.session.user.collectAsState()

    suspend fun load() {
        error = null
        try {
            wallet = Graph.repo.wallet()
            purchases = runCatching { Graph.repo.purchases() }.getOrDefault(emptyList())
        } catch (err: ApiException) {
            error = err.message
        } catch (err: Exception) {
            error = err.message ?: "网络异常"
        }
    }

    LaunchedEffect(Unit) { load() }

    if (error != null && wallet == null) {
        ErrorBox(error!!) { scope.launch { load() } }
        return
    }

    LazyColumn(modifier = Modifier.fillMaxWidth()) {
        item {
            SectionCard {
                Text(
                    text = user?.displayName?.takeIf { it.isNotBlank() }
                        ?: user?.username
                        ?: "读者",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "¥${money(wallet?.balance ?: 0)}",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                val mail = user?.email
                Text(
                    text = when {
                        mail.isNullOrBlank() -> "未绑定邮箱"
                        user?.emailVerified == true -> "$mail（已验证）"
                        else -> "$mail（未验证）"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        item {
            SectionCard(title = "兑换码充值") {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text("输入兑换码") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        scope.launch {
                            busy = true
                            message = null
                            try {
                                val result = Graph.repo.redeem(code.trim())
                                message = "充值成功 ¥${money(result.amount)}，余额 ¥${money(result.balance)}"
                                code = ""
                                load()
                            } catch (err: ApiException) {
                                message = err.message
                            } catch (err: Exception) {
                                message = err.message ?: "充值失败"
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy && code.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
                ) { Text(if (busy) "处理中…" else "充值") }

                message?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
        }

        item {
            SectionCard(title = "消费记录") {
                val items: List<WalletTransaction> = wallet?.transactions ?: emptyList()
                if (items.isEmpty()) {
                    Text(
                        text = "暂无记录",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Column {
                        for (tx in items.take(20)) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = when (tx.type) {
                                        "recharge" -> "充值"
                                        "purchase" -> "购买"
                                        else -> "调整"
                                    } + " · " + tx.createdAt.take(10),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = (if (tx.delta < 0) "-" else "+") + "¥" + money(kotlin.math.abs(tx.delta)),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (tx.delta < 0) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.primary
                                )
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
            }
        }

        item {
            SectionCard(title = "已购章节") {
                if (purchases.isEmpty()) {
                    Text(
                        text = "还没有购买过章节",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Column {
                        for (item in purchases.take(20)) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "书 ${item.novelId} · 第 ${item.chapterNumber} 章",
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.weight(1f)
                                )
                                OutlinedButton(onClick = { onOpenChapter(item.novelId, item.chapterNumber) }) {
                                    Text("阅读")
                                }
                            }
                        }
                    }
                }
            }
        }

        item {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        Graph.session.clear()
                        onLoggedOut()
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(16.dp)
            ) { Text("退出登录") }
        }
    }
}
