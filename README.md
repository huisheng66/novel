# 在线小说阅读与后台管理系统

这是一个基于 Express、EJS 和 MySQL 的在线小说阅读网站，包含前台阅读、后台登录、小说信息管理、章节管理、批量导入和访问数据仪表盘。

## 功能概览

- 前台小说目录页和章节阅读页
- 后台管理员登录，只需要输入密码
- 小说信息的新建、编辑和删除
- 章节的新建、编辑、删除和列表管理
- 后台章节切换时异步加载内容，减少整页刷新闪烁
- 批量上传 `.txt`、`.docx` 文件
- 自动识别文件内章节标题并拆分正文
- 批量导入支持追加和覆盖
- 未识别到章节标题时按单章导入
- 访问数据仪表盘，展示会话数、用户数、页面浏览量、独立 IP、热门路径和最近访问记录

## 技术栈

- Node.js
- Express 5
- EJS
- MySQL
- mysql2
- multer
- mammoth
- iconv-lite

## 环境要求

- Node.js 20+，需要支持 `node --env-file=.env`
- MySQL 5.7+ 或 MySQL 8+
- npm

## 安装

```powershell
npm install
```

## 环境变量

在项目根目录创建 `.env` 文件：

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=novel
PORT=3008
ADMIN_PASSWORD=change_this_password
ADMIN_SESSION_SECRET=change_this_secret
```

说明：

- `DB_HOST`：MySQL 地址
- `DB_USER`：MySQL 用户名
- `DB_PASSWORD`：MySQL 密码
- `DB_NAME`：数据库名称，启动时会自动创建
- `PORT`：服务端口，默认可使用 `3008`
- `ADMIN_PASSWORD`：后台登录密码
- `ADMIN_SESSION_SECRET`：后台登录 Cookie 签名密钥，生产环境必须设置为独立随机字符串

如果没有设置 `ADMIN_PASSWORD`，代码会使用默认值 `admin123`。生产环境不要使用默认密码。

## 启动

```powershell
npm start
```

启动成功后访问：

- 前台首页：http://localhost:3008/
- 后台登录：http://localhost:3008/admin/login
- 章节管理：http://localhost:3008/admin
- 小说信息：http://localhost:3008/admin/novels/info
- 数据仪表盘：http://localhost:3008/admin/dashboard

## 数据库

应用启动时会执行数据库初始化，自动创建数据库和以下数据表：

- `novels`：小说信息
- `chapters`：章节标题和正文
- `page_views`：页面访问记录
- `analytics_daily`：按天聚合的数据表

当 `novels` 表为空时，会插入一份示例小说和章节数据。

## 后台使用

1. 打开 `http://localhost:3008/admin/login`
2. 输入 `.env` 中配置的 `ADMIN_PASSWORD`
3. 登录后进入章节管理页
4. 右上角导航可切换到小说信息和数据仪表盘

章节管理页左侧是章节列表，右侧是章节管理区。点击左侧章节会在右侧加载章节内容，可直接修改或删除；也可以在右侧新建章节。

## 批量上传

后台章节管理页支持批量上传章节文件：

- 支持 `.txt`
- 支持 `.docx`
- 单个文件最大 30 MB
- 单次最多上传 50 个文件
- 支持追加导入
- 支持覆盖导入，覆盖会先删除当前小说已有章节

系统会尝试识别文件中的章节标题并拆分正文。支持的常见标题格式包括：

- `第一章 标题`
- `第001章 标题`
- `第十回 标题`
- `Chapter 1`
- 带编号前缀的章节标题

如果文件内没有识别到章节标题，系统会把整个文件按一个章节导入，章节标题使用文件名。

## 访问统计

前台 GET 请求会写入 `page_views` 表，后台和静态资源不会计入统计。数据仪表盘展示：

- 页面浏览量
- 会话数
- 用户数
- 独立 IP 数
- 最近 14 天趋势
- 热门访问路径
- 热门小说
- 高频 IP
- 最近访问记录

## 主要路由

前台：

- `GET /`：默认小说目录
- `GET /novel/:id`：指定小说目录
- `GET /novel/:id/:chapterNum`：章节阅读页

后台：

- `GET /admin/login`：后台登录页
- `POST /admin/login`：提交后台密码
- `POST /admin/logout`：退出登录
- `GET /admin`：章节管理
- `GET /admin/novels/info`：小说信息管理
- `GET /admin/dashboard`：数据仪表盘
- `POST /admin/novels`：创建小说
- `POST /admin/novels/:id`：更新小说
- `POST /admin/novels/:id/delete`：删除小说
- `POST /admin/chapters`：创建章节
- `POST /admin/chapters/:id`：更新章节
- `POST /admin/chapters/:id/delete`：删除章节
- `POST /admin/chapters/upload`：批量上传章节
- `GET /admin/api/chapters/:id`：获取章节详情

## 常见问题

### 端口被占用

修改 `.env` 中的 `PORT`，然后重新启动：

```env
PORT=3009
```

### 数据库连接失败

检查 MySQL 是否已启动，并确认 `.env` 中的数据库账号、密码和地址正确。

### 上传后中文乱码

`.txt` 文件建议使用 UTF-8 编码。系统也会尝试识别 UTF-16 和 GB18030 编码，但来源复杂的文本文件仍建议先转成 UTF-8。

### 后台登录失败

确认输入的是 `.env` 中配置的 `ADMIN_PASSWORD`。修改 `.env` 后需要重启服务。

## Ubuntu 服务器部署

Ubuntu 服务器上一键部署：

```bash
sudo bash scripts/deploy-ubuntu.sh
```

域名、HTTPS 和自定义密码用法见：[docs/ubuntu-deploy.md](docs/ubuntu-deploy.md)。
