1. 消息与联系人管理 (Claw API)
1.1 按名称查询 Feed
通过名称模糊搜索用户的普通会话列表 (包含群聊名称及好友备注名)。
- URL: /open/claw/feeds_by_name
- Method: POST
- Content-Type: application/json
请求参数 (JSON)
字段
类型
必填
描述
name
string
是
要模糊查询的 Feed 名称 (支持群名、好友备注名)
响应示例
{
  "code": 0,
  "data": [
    {
      "id": "12345",
      "chat_id": "67890"
    }
  ],
  "msg": "success"
}

---
1.2 按名称查询联系人
通过名称模糊搜索用户的好友联系人 (匹配名字、姓氏及备注名)。
- URL: /open/claw/contacts_by_name
- Method: POST
- Content-Type: application/json
请求参数 (JSON)
字段
类型
必填
描述
name
string
是
要模糊查询的好友名称或备注
响应示例
{
  "code": 0,
  "data": [
    {
      "friend_id": "10086"
    }
  ],
  "msg": "success"
}

---
2. 机器人扩展管理 (Robot API)
2.1 查询机器人所在群成员
查询机器人当前所在某个指定群组的成员列表。
- URL: /open/robot/group_members
- Method: POST
- Content-Type: application/json
请求参数 (JSON)
字段
类型
必填
描述
chatid
string
是
目标群组的 ChatID
响应示例
{
  "code": 0,
  "data": [
    {
      "user_id": "1001",
      "name": "User A",
      "avatar": "https://...",
      "member_role": 1,
      "joined_at": 1678901234000
    }
  ],
  "msg": "success"
}

---
3. 资源文件接口 (File API)
3.1 上传文件
允许 openclaw user上传图片、附件等资源，返回对应的 ObjectKey 以用于发送图片消息等场景。
- URL: /open/upload
- Method: POST
- Content-Type: multipart/form-data
请求表单参数 (Form-Data)
字段
类型
必填
描述
file_content
file
是
要上传的文件本身
file_name
string
否
文件名
file_type
string
是
文件类型 (如 image 或 file)
type_id
int
否
业务类型 ID
chat_id
string
是
文件所属的会话 ID
响应示例
{
  "code": 0,
  "data": {
    "id": "100",
    "objectKey": "upload/123456789.jpg",
    "address": "https://s3.xxx.com/...",
    "width": 1920,
    "height": 1080
  },
  "msg": "success"
}

---
3.2 读取/下载文件
获取已上传的聊天资源文件内容。调用该接口需要校验 Open User 是否在拥有此文件的会话中 (CheckOpenUserFileMiddleware 权限控制)。
- URL: /open/file
- Method: GET
请求参数 (Query)
字段
类型
必填
描述
id
string
否
文件在数据库中的 ID (与 object_key 二选一)
object_key
string
否
文件上传成功后返回的 objectKey (二选一)
响应
- 成功: 直接返回文件流数据，Content-Type 根据原文件类型而定。
- 失败: 若权限不足或文件不存在，将返回相应 HTTP 状态码或 JSON 错误格式。

发送消息
以 OpenClaw 助手身份向登录用户发送消息。所有接口均需在 Header 中携带有效的 Cookie: sessionid=... 进行鉴权。
- URL: /open/claw/send_message
- Method: POST
- Auth: Cookie Session (check_auth 返回的 sessionid)
- Content-Type: application/json
Header
Cookie: sessionid=<session_id>
请求体
字段
类型
描述
msg_type
int
消息类型 (0: 文本)
content
object
消息内容对象 (见下文)
is_delegate
bool
可选，是否代发
receiver_id
string
可选，向指定好友发消息
chat_id
string
可选，向指定会话发消息
content 结构示例 (文本/富文本 - msg_type: 0/1)
{
  "text": "这是一条测试消息"
}
content 结构示例 (图片 - msg_type: 2)
{
  "object_url": "s3_object_key_or_url",
  "thumb_url": "s3_object_key_or_url_for_thumb",
  "width": 1920,
  "height": 1080
}


cURL 示例
curl -X POST http://localhost:8080/open/claw/send_message \
  -H "Cookie: sessionid=..." \
  -H "Content-Type: application/json" \
  -d '{
    "msg_type": 0,
    "content": {
        "text": "您好，来自 OpenClaw 的消息！"
    }
  }'