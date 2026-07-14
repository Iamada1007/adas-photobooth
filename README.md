# Ada's Photobooth

一个可自定义四格相框的大头贴网页。上传相框后可以拖拽、拉伸四个拍照框，保存成贴纸模板；拍照时一格一格拍，拍满 4 格后生成成品和二维码。

## 本地打开

```bash
npm start
```

然后访问：

```text
http://localhost:4288
```

## 线上部署

这个版本已经可以部署成公开 HTTPS 网站。部署后，手机、电脑、平板只要打开同一个网址就能用。

推荐用 Netlify：

1. 把这个 `photobooth` 文件夹里的文件上传到 GitHub 仓库。
2. 在 Netlify 新建项目，选择这个 GitHub 仓库。
3. Build command 留空或填 `npm install`。
4. Publish directory 填 `.`。
5. Functions directory 使用默认的 `netlify/functions`。
6. 部署完成后，用 Netlify 给的 HTTPS 地址打开。

这个版本已经包含 Netlify Functions 和 Netlify Blobs，二维码下载链接会把成品 PNG 临时存到 Netlify。

也可以用 Render：

1. 在 Render 新建 Web Service。
2. Root Directory 留空。
3. Build Command 用 `npm install`。
4. Start Command 用 `npm start`。
5. 部署完成后，用 Render 给的 HTTPS 地址打开。

可选环境变量：

```text
PUBLIC_BASE_URL=https://你的域名
PHOTO_TTL_HOURS=24
```

`PUBLIC_BASE_URL` 用来生成二维码下载链接。多数平台会自动识别公开域名，不填也可以；如果二维码链接不对，再填它。

## 功能

- 上传一整张四格相框模板
- 上传后可直接拖拽、拉伸四个拍照框来对齐相框
- 可保存为贴纸模板，下次从模板库直接选择
- 模板库支持删除不要的模板
- 拍完后可点“完成/下一张”，保留当前模板继续拍
- 竖版模板自动使用四条横向拍照窗口
- 横版或方形模板自动使用 2 x 2 窗口
- 普通模板只出现一次，照片填进四个窗口
- 透明 PNG 模板只出现一次，并覆盖在照片上
- 四格一格一格拍，每格都有 3 秒倒计时
- 倒计时有 3、2、1 提示音
- 支持重拍上一格
- 拍摄中和成品都保持镜像
- 成品 PNG 下载
- 生成二维码扫码下载

## 注意

浏览器摄像头要求 HTTPS。线上部署后会正常工作；如果只是用局域网 `http://192.168...` 打开，部分手机浏览器可能不允许摄像头。

成品照片会临时保存在服务器的 `shares/` 文件夹，默认 24 小时后自动清理。
