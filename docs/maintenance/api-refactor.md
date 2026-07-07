# API 重构说明文档

## 概述

本次重构对 `app.py` 文件中的 `/generate-script` 接口进行了重大升级，现在支持三种不同的输入类型：PDF、URL 和纯文本。

## 新增依赖库

重构添加了以下新的依赖库：

```python
import requests          # 用于HTTP请求
import tempfile          # 用于创建临时文件
from bs4 import BeautifulSoup  # 用于HTML解析
import fitz              # PyMuPDF，用于PDF文本提取
```

## 依赖安装

请确保安装了所有必要的依赖：

```bash
pip install -r requirements.txt
```

主要新增的依赖包括：
- `PyMuPDF` - PDF文本提取
- `beautifulsoup4` - HTML解析
- `requests` - HTTP请求

## API 接口重构

### `/generate-script` 接口

**请求方法：** POST  
**Content-Type：** application/json

#### 请求参数

```json
{
    "inputType": "pdf|url|text",
    "content": "输入内容",
    "mode": "single|role",
    "geminiModel": "模型名称",
    "duration": "时长描述"
}
```

#### 参数说明

- `inputType` (必需): 输入类型
  - `"pdf"`: PDF文件（Base64编码）
  - `"url"`: 网页URL
  - `"text"`: 纯文本内容
- `content` (必需): 根据inputType不同，内容格式也不同
- `mode` (必需): 生成模式
  - `"single"`: 单人播客
  - `"role"`: 双人对话
- `geminiModel` (必需): Gemini模型名称
- `duration` (必需): 期望的播客时长

#### 响应格式

**成功响应 (200):**
```json
{
    "script": "生成的播客脚本内容"
}
```

**错误响应 (400/500):**
```json
{
    "error": "错误描述信息"
}
```

## 输入类型处理逻辑

### 1. PDF 输入处理

当 `inputType` 为 `"pdf"` 时：

1. **Base64解码**: 将 `content` 从Base64字符串解码为二进制数据
2. **临时文件创建**: 将解码后的数据写入临时PDF文件
3. **文本提取**: 使用PyMuPDF逐页提取文本内容
4. **文件清理**: 提取完成后删除临时文件
5. **错误处理**: 捕获PDF解析异常并返回具体错误信息

**示例请求:**
```json
{
    "inputType": "pdf",
    "content": "JVBERi0xLjQKJcOkw7zDtsO...",
    "mode": "single",
    "geminiModel": "gemini-1.5-flash",
    "duration": "5分钟"
}
```

### 2. URL 输入处理

当 `inputType` 为 `"url"` 时：

1. **HTTP请求**: 使用requests库抓取网页内容
2. **HTML解析**: 使用BeautifulSoup解析HTML结构
3. **内容清理**: 移除script和style标签
4. **文本提取**: 提取主要文本内容并清理格式
5. **错误处理**: 处理网络请求和解析异常

**示例请求:**
```json
{
    "inputType": "url",
    "content": "https://example.com/article",
    "mode": "role",
    "geminiModel": "gemini-1.5-flash",
    "duration": "10分钟"
}
```

### 3. 纯文本输入处理

当 `inputType` 为 `"text"` 时：

1. **直接使用**: 直接使用 `content` 作为输入文本
2. **内容验证**: 确保文本不为空

**示例请求:**
```json
{
    "inputType": "text",
    "content": "这是一段要转换为播客脚本的文本内容...",
    "mode": "single",
    "geminiModel": "gemini-1.5-flash",
    "duration": "3分钟"
}
```

## 错误处理机制

### 输入验证错误 (400)

- **缺少参数**: 当必需参数缺失时
- **无效输入类型**: 当inputType不是支持的类型时
- **空内容**: 当提取的文本内容为空时

### 处理错误 (400)

- **PDF解析失败**: PDF文件损坏或无法提取文本
- **URL访问失败**: 网络连接问题或URL无效
- **内容解析失败**: HTML解析或文本提取失败

### 系统错误 (500)

- **Gemini API调用失败**: 模型调用异常
- **其他未预期错误**: 系统级异常

## 测试

使用提供的测试脚本验证功能：

```bash
python test_input_types.py
```

测试脚本会验证：
- 纯文本输入处理
- URL输入处理
- PDF输入处理
- 错误输入处理

## 安全考虑

1. **临时文件管理**: 所有临时PDF文件都会在处理完成后立即删除
2. **输入验证**: 对所有输入参数进行严格验证
3. **错误信息**: 提供详细的错误信息但不暴露系统内部细节
4. **超时控制**: URL请求设置了30秒超时限制

## 性能优化

1. **内存管理**: 使用临时文件避免大PDF文件占用过多内存
2. **文本清理**: 对提取的文本进行格式清理，提高后续处理效率
3. **异常处理**: 快速失败机制，避免无效请求占用资源

## 向后兼容性

重构后的接口保持了与原有接口的兼容性，但建议前端更新为新的参数格式以获得更好的功能支持。 