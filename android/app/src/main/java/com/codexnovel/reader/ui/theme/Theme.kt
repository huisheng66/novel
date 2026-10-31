package com.codexnovel.reader.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** 支持「跟随系统 / 浅色 / 深色 / 护眼」四种阅读主题 */
@Composable
fun ReaderTheme(theme: String, content: @Composable () -> Unit) {
    val colorScheme = when (theme) {
        "dark" -> darkScheme()
        "sepia" -> sepiaScheme()
        "light" -> lightScheme()
        else -> if (isSystemInDarkTheme()) darkScheme() else lightScheme()
    }

    MaterialTheme(colorScheme = colorScheme, typography = Typography(), content = content)
}

private fun lightScheme() = lightColorScheme(
    primary = Color(0xFFB76E3C),
    onPrimary = Color.White,
    background = Color(0xFFFDFCFA),
    onBackground = Color(0xFF1A1A1A),
    surface = Color(0xFFF7F7F5),
    onSurface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFFEFEDE9),
    onSurfaceVariant = Color(0xFF6B6B67),
    outline = Color(0xFFE6E3DE)
)

private fun darkScheme() = darkColorScheme(
    primary = Color(0xFFC9956B),
    onPrimary = Color(0xFF241609),
    background = Color(0xFF16161A),
    onBackground = Color(0xFFDCDCD8),
    surface = Color(0xFF1F1F24),
    onSurface = Color(0xFFDCDCD8),
    surfaceVariant = Color(0xFF2A2A30),
    onSurfaceVariant = Color(0xFF9A9A9E),
    outline = Color(0xFF2C2C31)
)

private fun sepiaScheme() = lightColorScheme(
    primary = Color(0xFF9A6A3A),
    onPrimary = Color.White,
    background = Color(0xFFF5ECD9),
    onBackground = Color(0xFF3A3125),
    surface = Color(0xFFEFE4CC),
    onSurface = Color(0xFF3A3125),
    surfaceVariant = Color(0xFFE7DBC2),
    onSurfaceVariant = Color(0xFF8A7C66),
    outline = Color(0xFFDDD0B4)
)

fun money(cents: Int): String = "%.2f".format((cents.coerceAtLeast(0)) / 100.0)
