package com.codexnovel.reader.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.codexnovel.reader.ui.screens.AuthScreen
import com.codexnovel.reader.ui.screens.BookScreen
import com.codexnovel.reader.ui.screens.LibraryScreen
import com.codexnovel.reader.ui.screens.ReaderScreen
import com.codexnovel.reader.ui.screens.ShelfScreen
import com.codexnovel.reader.ui.screens.WalletScreen

private object Routes {
    const val AUTH = "auth"
    const val LIBRARY = "library"
    const val SHELF = "shelf"
    const val WALLET = "wallet"
    const val BOOK = "book/{id}"
    const val READ = "read/{id}/{n}"

    fun book(id: Int) = "book/$id"
    fun read(id: Int, n: Int) = "read/$id/$n"
}

private val tabRoutes = setOf(Routes.LIBRARY, Routes.SHELF, Routes.WALLET)

@Composable
fun AppNav(startLoggedIn: Boolean) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val currentRoute = entry?.destination?.route

    Scaffold(
        bottomBar = {
            if (currentRoute in tabRoutes) {
                NavigationBar {
                    NavigationBarItem(
                        selected = currentRoute == Routes.LIBRARY,
                        onClick = { nav.switchTab(Routes.LIBRARY) },
                        icon = { Text("书") },
                        label = { Text("书库") }
                    )
                    NavigationBarItem(
                        selected = currentRoute == Routes.SHELF,
                        onClick = { nav.switchTab(Routes.SHELF) },
                        icon = { Text("架") },
                        label = { Text("书架") }
                    )
                    NavigationBarItem(
                        selected = currentRoute == Routes.WALLET,
                        onClick = { nav.switchTab(Routes.WALLET) },
                        icon = { Text("我") },
                        label = { Text("我的") }
                    )
                }
            }
        }
    ) { padding ->
        NavHost(
            navController = nav,
            startDestination = if (startLoggedIn) Routes.LIBRARY else Routes.AUTH,
            modifier = Modifier.padding(padding)
        ) {
            composable(Routes.AUTH) {
                AuthScreen(onLoggedIn = { nav.resetTo(Routes.LIBRARY) })
            }

            composable(Routes.LIBRARY) {
                LibraryScreen(onOpenBook = { id -> nav.navigate(Routes.book(id)) })
            }

            composable(Routes.SHELF) {
                ShelfScreen(
                    onOpenBook = { id -> nav.navigate(Routes.book(id)) },
                    onRead = { id, n -> nav.navigate(Routes.read(id, n)) }
                )
            }

            composable(Routes.WALLET) {
                WalletScreen(
                    onLoggedOut = { nav.resetTo(Routes.AUTH) },
                    onOpenChapter = { id, n -> nav.navigate(Routes.read(id, n)) }
                )
            }

            composable(Routes.BOOK) { stackEntry ->
                val id = stackEntry.arguments?.getString("id")?.toIntOrNull() ?: 0
                BookScreen(bookId = id, onRead = { bookId, n -> nav.navigate(Routes.read(bookId, n)) })
            }

            composable(Routes.READ) { stackEntry ->
                val id = stackEntry.arguments?.getString("id")?.toIntOrNull() ?: 0
                val n = stackEntry.arguments?.getString("n")?.toIntOrNull() ?: 1

                ReaderScreen(
                    bookId = id,
                    chapterNumber = n,
                    onBack = { nav.popBackStack() },
                    onOpenBook = { bookId -> nav.navigate(Routes.book(bookId)) },
                    onOpenWallet = { nav.switchTab(Routes.WALLET) },
                    onGoChapter = { next -> nav.navigate(Routes.read(id, next)) }
                )
            }
        }
    }
}

/** 底部 tab 切换：不堆栈，重复点同一个也不新开 */
private fun NavHostController.switchTab(route: String) {
    navigate(route) {
        popUpTo(graph.startDestinationId) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** 登录/登出后清空返回栈 */
private fun NavHostController.resetTo(route: String) {
    navigate(route) {
        popUpTo(graph.id) { inclusive = true }
        launchSingleTop = true
    }
}
