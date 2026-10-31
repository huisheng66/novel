package com.codexnovel.reader.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.codexnovel.reader.Graph
import com.codexnovel.reader.data.ApiException
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(onLoggedIn: () -> Unit) {
    var isRegister by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy) return
        error = null
        notice = null

        if (email.isBlank() || password.length < 8) {
            error = "请填写邮箱，密码至少 8 位"
            return
        }

        busy = true
        scope.launch {
            try {
                if (isRegister) {
                    val result = Graph.repo.register(email.trim(), password, invite)
                    notice = if (result.emailVerificationSent) "注册成功，验证邮件已发送" else "注册成功"
                } else {
                    Graph.repo.login(email.trim(), password)
                }
                onLoggedIn()
            } catch (err: ApiException) {
                error = err.message
            } catch (err: Exception) {
                error = err.message ?: "网络异常，请检查服务端地址"
            } finally {
                busy = false
            }
        }
    }

    Column(modifier = Modifier.fillMaxWidth().padding(24.dp)) {
        Text("书库", style = MaterialTheme.typography.headlineSmall)
        Text(
            text = if (isRegister) "用邮箱注册，邀请码选填" else "用邮箱或用户名登录",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp, bottom = 16.dp)
        )

        TabRow(selectedTabIndex = if (isRegister) 1 else 0) {
            Tab(selected = !isRegister, onClick = { isRegister = false; error = null }, text = { Text("登录") })
            Tab(selected = isRegister, onClick = { isRegister = true; error = null }, text = { Text("注册") })
        }

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text(if (isRegister) "邮箱" else "邮箱或用户名") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (isRegister) KeyboardType.Email else KeyboardType.Text,
                imeAction = ImeAction.Next
            ),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
        )

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("密码（至少 8 位）") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
        )

        if (isRegister) {
            OutlinedTextField(
                value = invite,
                onValueChange = { invite = it },
                label = { Text("邀请码（选填）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
            )
        }

        error?.let {
            Text(
                text = it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 12.dp)
            )
        }
        notice?.let {
            Text(
                text = it,
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 12.dp)
            )
        }

        Button(
            onClick = { submit() },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().padding(top = 18.dp)
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = MaterialTheme.colorScheme.onPrimary
                )
            } else {
                Text(if (isRegister) "注册并登录" else "登录")
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "忘记密码请在网页版 /forgot-password 重置",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
