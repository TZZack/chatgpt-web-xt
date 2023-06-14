# 二次开发相关记录

### 模型相关

模型展示那里，只展示了v1/chat/completions和v1/completions相关的模型（具体看opai的[链接](https://platform.openai.com/docs/models/how-we-use-your-data))

[Model endpoint compatibility](https://platform.openai.com/docs/models/model-endpoint-compatibility)

| ENDPOINT                 | MODEL NAME                                                   |
| :----------------------- | :----------------------------------------------------------- |
| /v1/chat/completions     | gpt-4, gpt-4-0613, gpt-4-32k, gpt-4-32k-0613, gpt-3.5-turbo, gpt-3.5-turbo-0613, gpt-3.5-turbo-16k, gpt-3.5-turbo-16k-0613 |
| /v1/completions          | text-davinci-003, text-davinci-002, text-curie-001, text-babbage-001, text-ada-001 |
| /v1/edits                | text-davinci-edit-001, code-davinci-edit-001                 |
| /v1/audio/transcriptions | whisper-1                                                    |
| /v1/audio/translations   | whisper-1                                                    |
| /v1/fine-tunes           | davinci, curie, babbage, ada                                 |
| /v1/embeddings           | text-embedding-ada-002, text-search-ada-doc-001              |
| /v1/moderations          | text-moderation-stable, text-moderation-latest               |

openai那边后续也肯定会新增一些模型（最近就是新增了gpt-3.5-turbo-0613, gpt-3.5-turbo-16k, gpt-3.5-turbo-16k-0613）

#### 新增模型如何处理

1. 前端这边请求完模型列表接口后做了过滤，需要在过滤那里把新的模型加上
2. 后端那边有个包@tzzack/chatgpt，基于chatgpt-api这个包二次改造的，因为之前不支持配终端地址，那边也需要对新增的模型做判断，并使用正确的终端地址（[github](https://github.com/TZZack/chatgpt-api),看之前的PR就只能如何修改了，改完发包升级即可）