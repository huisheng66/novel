plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.codexnovel.reader"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.codexnovel.reader"
        minSdk = 24
        targetSdk = 35
        versionCode = 3
        versionName = "1.1.1"

        // 模拟器访问宿主机用 10.0.2.2；真机改成局域网 IP：
        //   ./gradlew assembleDebug -PapiBaseUrl=http://192.168.1.10:3008/api/v1/
        val apiBase = (project.findProperty("apiBaseUrl") as String?)
            ?: "http://10.0.2.2:3008/api/v1/"
        buildConfigField("String", "API_BASE_URL", "\"$apiBase\"")
        // 备用线路（分号分隔，网络失败时按序回退）：直连源站 IP，绕过 Cloudflare
        val fallback = (project.findProperty("apiFallbackUrls") as String?)
            ?: "http://35.78.226.63/api/v1/"
        buildConfigField("String", "API_FALLBACK_URLS", "\"$fallback\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.8.4")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    implementation("io.coil-kt:coil-compose:2.7.0")
    testImplementation("junit:junit:4.13.2")
}
