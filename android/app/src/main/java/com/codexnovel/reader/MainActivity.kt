package com.codexnovel.reader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.codexnovel.reader.ui.AppNav
import com.codexnovel.reader.ui.theme.ReaderTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            val theme by Graph.prefs.theme.collectAsState()
            ReaderTheme(theme = theme) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Boot()
                }
            }
        }
    }

    @Composable
    private fun Boot() {
        var ready by remember { mutableStateOf(false) }
        var loggedIn by remember { mutableStateOf(false) }

        LaunchedEffect(Unit) {
            // 先把本地登录态与偏好读出来，再决定首屏是登录还是书库
            Graph.session.load()
            Graph.prefs.load()
            loggedIn = Graph.session.isLoggedIn()
            ready = true
        }

        if (!ready) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            AppNav(startLoggedIn = loggedIn)
        }
    }
}
