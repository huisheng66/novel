# 书库 Android 客户端（Kotlin + Compose）

原生 Android 阅读器，直接对接服务端现有的 `/api/v1`，不依赖任何第三方书源协议。

## 已实现

| 能力 | 说明 |
|---|---|
| 邮箱注册 / 登录 | 与网页、App 共用一套账号；token 2 小时自动刷新（401 静默重试一次） |
| 书库 + 搜索 | 分页加载 |
| 书籍详情 + 目录 | 目录分页、付费章节带价格标记 |
| 阅读器 | 段落排版、字号调节、四套主题（跟随系统/浅色/深色/护眼）、上下章、返回 |
| 进度同步 | 本地立即存、云端延迟 800ms 推；与后端 LWW 语义一致（谁的时间新用谁的） |
| 书架 | 加入/移出、显示读到第几章、有更新标记 |
| 付费章节 | 402 时展示试读 + 价格 + 一键购买；余额不足跳钱包 |
| 钱包 | 余额、兑换码充值、消费记录、已购章节、退出登录 |

## 未实现（下一阶段）

- 离线缓存整本章节（目前只缓存进度，正文不落盘）
- 章评 / 书评
- 推送（服务端 `device_subscriptions` 已有表，但还没有真实推送通道）
- 支付通道（微信/支付宝 / iOS IAP）

## 环境要求

- JDK 17
- Android SDK：Platform 35、Build-Tools 35.0.0
- Gradle 8.9+（本仓库不提交 wrapper，用系统已装的 Gradle 即可）

## 配置服务端地址

默认指向模拟器宿主机：

```
http://10.0.2.2:3008/api/v1/
```

真机调试改成局域网 IP（注意**结尾必须带 `/`**，Retrofit 的相对路径依赖它）：

```bash
gradle -p android assembleDebug -PapiBaseUrl=http://192.168.1.10:3008/api/v1/
```

也可以把 `apiBaseUrl` 写进 `android/gradle.properties`，避免每次传参。

> 本地是 http，所以 Manifest 里开了 `usesCleartextTraffic`。上线换 https 后请关掉。

## 构建与安装

```bash
# 编译 Debug APK
gradle -p android assembleDebug

# 产物
# android/app/build/outputs/apk/debug/app-debug.apk

# 安装到已连接设备/模拟器
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 代码结构

```
app/src/main/java/com/codexnovel/reader/
  Graph.kt                 依赖容器（这个规模不上 Hilt）
  ReaderApp.kt / MainActivity.kt
  data/
    Models.kt              DTO（kotlinx.serialization）
    ApiService.kt          Retrofit 接口
    Network.kt             OkHttp + token 拦截器
    SessionStore.kt        登录态（DataStore，内存里留副本给拦截器）
    PrefsStore.kt          主题/字号 + 本地进度
    Repository.kt          业务调用 + 401 刷新重试 + 错误翻译
  ui/
    AppNav.kt              路由 + 底部 tab
    Components.kt          列表行、加载/错误占位
    theme/Theme.kt         四套配色
    screens/               Auth / Library / Book / Reader / Wallet
```

## 设计取舍

- **没有 ViewModel**：页面状态放 `remember`，Manifest 里固定 `configChanges` 避免旋转重建。这个体量上 ViewModel 只会增加样板。
- **刷新不用 OkHttp Authenticator**：改成 Repository 里捕获 401 → 刷新 → 重试一次，逻辑集中在肉眼可见的地方，也避免 Authenticator 在并发下的重复刷新。
- **进度双写**：本地先写（离线可续读），云端后推（跨设备）。合并规则与后端一致：`updatedAt` 新的胜出。
