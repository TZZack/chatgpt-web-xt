import { createReadStream, existsSync, readdirSync, rmSync } from 'fs'
import { exec } from 'child_process'
import Readline from 'readline'
import * as dotenv from 'dotenv'
import 'isomorphic-fetch'
import type { ChatGPTAPIOptions, ChatMessage, SendMessageOptions } from '@tzzack/chatgpt'
import { ChatGPTAPI, ChatGPTUnofficialProxyAPI } from '@tzzack/chatgpt'
import { SocksProxyAgent } from 'socks-proxy-agent'
import httpsProxyAgent from 'https-proxy-agent'
import fetch, { FormData, fileFromSync } from 'node-fetch'
import { handlerFullPath } from 'src/utils/file'
import { sendResponse } from '../utils'
import { isNotEmptyString } from '../utils/is'
import type { ApiModel, ChatContext, ChatGPTUnofficialProxyAPIOptions, ModelConfig } from '../types'
import type { BalanceResponse, RequestOptions } from './types'

const { HttpsProxyAgent } = httpsProxyAgent

dotenv.config()

const ErrorCodeMessage: Record<string, string> = {
  401: '[OpenAI] 提供错误的API密钥 | Incorrect API key provided',
  403: '[OpenAI] 服务器拒绝访问，请稍后再试 | Server refused to access, please try again later',
  502: '[OpenAI] 错误的网关 |  Bad Gateway',
  503: '[OpenAI] 服务器繁忙，请稍后再试 | Server is busy, please try again later',
  504: '[OpenAI] 网关超时 | Gateway Time-out',
  500: '[OpenAI] 服务器繁忙，请稍后再试 | Internal Server Error',
}

const timeoutMs: number = !isNaN(+process.env.TIMEOUT_MS) ? +process.env.TIMEOUT_MS : 30 * 1000
const disableDebug: boolean = process.env.OPENAI_API_DISABLE_DEBUG === 'true'

let apiModel: ApiModel

if (!isNotEmptyString(process.env.OPENAI_API_KEY) && !isNotEmptyString(process.env.OPENAI_ACCESS_TOKEN))
  throw new Error('Missing OPENAI_API_KEY or OPENAI_ACCESS_TOKEN environment variable')

let api: ChatGPTAPI | ChatGPTUnofficialProxyAPI

(async () => {
  // More Info: https://github.com/transitive-bullshit/chatgpt-api

  if (isNotEmptyString(process.env.OPENAI_API_KEY)) {
    const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL
    const OPENAI_API_MODEL = process.env.OPENAI_API_MODEL
    const model = isNotEmptyString(OPENAI_API_MODEL) ? OPENAI_API_MODEL : 'gpt-3.5-turbo'

    const options: ChatGPTAPIOptions = {
      apiKey: process.env.OPENAI_API_KEY,
      completionParams: { model },
      debug: !disableDebug,
    }

    // increase max token limit if use gpt-4
    if (model.toLowerCase().includes('gpt-4')) {
      // if use 32k model
      if (model.toLowerCase().includes('32k')) {
        options.maxModelTokens = 32768
        options.maxResponseTokens = 8192
      }
      else {
        options.maxModelTokens = 8192
        options.maxResponseTokens = 2048
      }
    }

    if (isNotEmptyString(OPENAI_API_BASE_URL))
      options.apiBaseUrl = `${OPENAI_API_BASE_URL}/v1`

    setupProxy(options)

    api = new ChatGPTAPI({ ...options })
    apiModel = 'ChatGPTAPI'
  }
  else {
    const OPENAI_API_MODEL = process.env.OPENAI_API_MODEL
    const options: ChatGPTUnofficialProxyAPIOptions = {
      accessToken: process.env.OPENAI_ACCESS_TOKEN,
      debug: !disableDebug,
    }

    if (isNotEmptyString(OPENAI_API_MODEL))
      options.model = OPENAI_API_MODEL

    options.apiReverseProxyUrl = isNotEmptyString(process.env.API_REVERSE_PROXY)
      ? process.env.API_REVERSE_PROXY
      : 'https://bypass.churchless.tech/api/conversation'

    setupProxy(options)

    api = new ChatGPTUnofficialProxyAPI({ ...options })
    apiModel = 'ChatGPTUnofficialProxyAPI'
  }
})()

async function chatReplyProcess(options: RequestOptions) {
  const { message, lastContext, process, systemMessage, completionParams } = options
  try {
    let options: SendMessageOptions = { timeoutMs }

    if (apiModel === 'ChatGPTAPI') {
      if (isNotEmptyString(systemMessage))
        options.systemMessage = systemMessage
    }

    if (lastContext != null) {
      if (apiModel === 'ChatGPTAPI')
        options.parentMessageId = lastContext.parentMessageId
      else
        options = { ...lastContext }
    }

    const response = await api.sendMessage(message, {
      ...options,
      completionParams,
      onProgress: (partialResponse) => {
        process?.(partialResponse)
      },
    })

    return sendResponse({ type: 'Success', data: response })
  }
  catch (error: any) {
    const code = error.statusCode
    global.console.log(error)
    if (Reflect.has(ErrorCodeMessage, code))
      return sendResponse({ type: 'Fail', message: ErrorCodeMessage[code] })
    return sendResponse({ type: 'Fail', message: error.message ?? 'Please check the back-end console' })
  }
}

async function fetchBalance() {
  // 计算起始日期和结束日期

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

  if (!isNotEmptyString(OPENAI_API_KEY))
    return Promise.resolve('-')

  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
    ? OPENAI_API_BASE_URL
    : 'https://api.openai.com'

  const [startDate, endDate] = formatDate()

  // 每月使用量
  const urlUsage = `${API_BASE_URL}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`

  const headers = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  }

  try {
    // 获取已使用量
    const useResponse = await fetch(urlUsage, { headers })
    const usageData = await useResponse.json() as BalanceResponse
    const usage = Math.round(usageData.total_usage) / 100
    return Promise.resolve(usage ? `$${usage}` : '-')
  }
  catch {
    return Promise.resolve('-')
  }
}

function formatDate(): string[] {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth() + 1
  const lastDay = new Date(year, month, 0)
  const formattedFirstDay = `${year}-${month.toString().padStart(2, '0')}-01`
  const formattedLastDay = `${year}-${month.toString().padStart(2, '0')}-${lastDay.getDate().toString().padStart(2, '0')}`
  return [formattedFirstDay, formattedLastDay]
}

async function chatConfig() {
  const balance = await fetchBalance()
  const reverseProxy = process.env.API_REVERSE_PROXY ?? '-'
  const httpsProxy = (process.env.HTTPS_PROXY || process.env.ALL_PROXY) ?? '-'
  const socksProxy = (process.env.SOCKS_PROXY_HOST && process.env.SOCKS_PROXY_PORT)
    ? (`${process.env.SOCKS_PROXY_HOST}:${process.env.SOCKS_PROXY_PORT}`)
    : '-'
  return sendResponse<ModelConfig>({
    type: 'Success',
    data: { apiModel, reverseProxy, timeoutMs, socksProxy, httpsProxy, balance },
  })
}

function setupProxy(options: ChatGPTAPIOptions | ChatGPTUnofficialProxyAPIOptions) {
  if (isNotEmptyString(process.env.SOCKS_PROXY_HOST) && isNotEmptyString(process.env.SOCKS_PROXY_PORT)) {
    const agent = new SocksProxyAgent({
      hostname: process.env.SOCKS_PROXY_HOST,
      port: process.env.SOCKS_PROXY_PORT,
      userId: isNotEmptyString(process.env.SOCKS_PROXY_USERNAME) ? process.env.SOCKS_PROXY_USERNAME : undefined,
      password: isNotEmptyString(process.env.SOCKS_PROXY_PASSWORD) ? process.env.SOCKS_PROXY_PASSWORD : undefined,
    })
    options.fetch = (url, options) => {
      return fetch(url, { agent, ...options })
    }
  }
  else {
    if (isNotEmptyString(process.env.HTTPS_PROXY) || isNotEmptyString(process.env.ALL_PROXY)) {
      const httpsProxy = process.env.HTTPS_PROXY || process.env.ALL_PROXY
      if (httpsProxy) {
        const agent = new HttpsProxyAgent(httpsProxy)
        options.fetch = (url, options) => {
          return fetch(url, { agent, ...options })
        }
      }
    }
  }
}

async function getModels() {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

  if (!isNotEmptyString(OPENAI_API_KEY))
    return Promise.resolve('-')

  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
    ? OPENAI_API_BASE_URL
    : 'https://api.openai.com'

  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    const response = await fetch(`${API_BASE_URL}/v1/models`, { headers })
    const modelsData = await response.json()
    return sendResponse({
      type: 'Success',
      data: (modelsData as any)?.data || [],
    })
  }
  catch {
    return sendResponse({
      type: 'Fail',
      message: '获取失败',
      data: [],
    })
  }
}

async function getList() {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

  if (!isNotEmptyString(OPENAI_API_KEY))
    return Promise.resolve('-')

  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
    ? OPENAI_API_BASE_URL
    : 'https://api.openai.com'

  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    const response = await fetch(`${API_BASE_URL}/v1/fine-tunes`, { headers })
    const modelsData = await response.json()
    return sendResponse({
      type: 'Success',
      data: (modelsData as any)?.data || [],
    })
  }
  catch {
    return sendResponse({
      type: 'Fail',
      message: '获取失败',
      data: [],
    })
  }
}

async function getModelDetail(req: any) {
  const { fine_tune_id } = req.body as { fine_tune_id: string }
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

  if (!isNotEmptyString(OPENAI_API_KEY))
    return Promise.resolve('-')

  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
    ? OPENAI_API_BASE_URL
    : 'https://api.openai.com'

  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    const response = await fetch(`${API_BASE_URL}/v1/fine-tunes/${fine_tune_id}/events`, { headers })
    const modelDetailData = await response.json()
    return sendResponse({
      type: 'Success',
      data: (modelDetailData as any)?.data || [],
    })
  }
  catch {
    return sendResponse({
      type: 'Fail',
      message: '获取失败',
      data: [],
    })
  }
}

interface CreateModelRes {
  message: string
  data: {}
  status: 'Success' | 'Fail'
}

function createModel(req: any) {
  const highSetting = ['n_epochs', 'batch_size', 'learning_rate_multiplier', 'compute_classification_metrics']
  let execStr = `openai api fine_tunes.create -t ${req.body.training_file} -m ${req.body.model} --suffix ${req.body.suffix}`

  highSetting.forEach((item) => {
    if (req.body[item]) {
      if (item === 'compute_classification_metrics')
        execStr += ` --${item}`

      else
        execStr += ` --${item} ${req.body[item]}`
    }
  })
  return new Promise<CreateModelRes>((resolve, reject) => {
    exec(execStr, (_err) => {
      if (_err)
        return reject(new Error(_err.message))

      return resolve({ message: '创建成功', data: {}, status: 'Success' })
    })
  })
}

async function cancelModel(req: any) {
  const { id } = req.body as { id: string }
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

  if (!isNotEmptyString(OPENAI_API_KEY))
    return Promise.resolve('-')

  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
    ? OPENAI_API_BASE_URL
    : 'https://api.openai.com'

  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    const response = await fetch(`${API_BASE_URL}/v1/fine-tunes/${id}/cancel`, { headers, method: 'POST' })
    const cancelModelResponseData = await response.json()
    return sendResponse({
      type: 'Success',
      data: cancelModelResponseData || {},
    })
  }
  catch {
    return sendResponse({
      type: 'Fail',
      message: '取消失败',
      data: {},
    })
  }
}

async function deleteModel(req: any) {
  const { fine_tuned_model } = req.body as { fine_tuned_model: string }
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

  if (!isNotEmptyString(OPENAI_API_KEY))
    return Promise.resolve('-')

  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
    ? OPENAI_API_BASE_URL
    : 'https://api.openai.com'

  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    const response = await fetch(`${API_BASE_URL}/v1/models/${fine_tuned_model}`, { headers, method: 'DELETE' })
    const deleteModelResponseData = await response.json()
    return sendResponse({
      type: 'Success',
      data: deleteModelResponseData || {},
    })
  }
  catch {
    return sendResponse({
      type: 'Fail',
      message: '取消失败',
      data: {},
    })
  }
}

async function uploadFile(file: any) {
  const purpose = 'fine-tune' // 目的先默认为微调
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

  if (!isNotEmptyString(OPENAI_API_KEY))
    return ''

  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
    ? OPENAI_API_BASE_URL
    : 'https://api.openai.com'

  const formData = new FormData()
  formData.append('file', file)
  formData.append('purpose', purpose)

  try {
    const headers = { Authorization: `Bearer ${OPENAI_API_KEY}` }
    const response = await fetch(`${API_BASE_URL}/v1/files`, {
      headers,
      method: 'POST',
      body: formData,
    })
    const uploadRes = await response.json()
    return (uploadRes as any)?.id || ''
  }
  catch {
    return ''
  }
}

function currentModel(): ApiModel {
  return apiModel
}

interface PrepareDataRes {
  message: string
  data: '' | { id: string; list: Record<string, any>[] }
  status: 'Success' | 'Fail'
}

function findFile(folder: string, filename: string) {
  // 查找解析后的文件
  const files = readdirSync(folder).filter(item => item !== filename)
  // 先找文件名存在train的，如果不存在，则找prepared，实在不对劲最后再找非源文件的
  let preparedFilename = files.find(item => item.includes('train'))
  !preparedFilename && (preparedFilename = files.find(item => item.includes('prepared')))
  !preparedFilename && (preparedFilename = files[0])
  return preparedFilename
}

function prepareData(file: any) {
  const { filename, folder } = handlerFullPath(file.path)
  return new Promise<PrepareDataRes>((resolve, reject) => {
    if (existsSync(file.path)) {
      exec(`cd ${folder} &&  openai tools fine_tunes.prepare_data -f ${filename} -q`, (_err) => {
        if (_err) {
          reject(new Error(_err.message))
          return
        }
        const parsedFilename = findFile(folder, filename)
        if (!parsedFilename) {
          resolve({ message: '文件解析失败', data: '', status: 'Success' })
          return
        }
        const preparedFile = `${folder}/${parsedFilename}`
        uploadFile(fileFromSync(preparedFile, 'text/plain')).then((res) => {
          const preparedFileData = createReadStream(preparedFile)
          const rl = Readline.createInterface({
            input: preparedFileData,
            crlfDelay: Infinity,
          })
          const MAX_LINE = 100
          const list = []
          rl.on('line', (line) => {
            if (list.length >= MAX_LINE) {
              rl.close()
              return
            }

            try {
              list.push(JSON.parse(line))
            }
            catch (err) {}
          })
          rl.on('close', () => {
            resolve({ message: '', data: { id: res, list }, status: 'Success' })
          })
        })
      })
      return
    }
    resolve({ message: '文件解析失败', data: null, status: 'Fail' })
  }).finally(() => {
    rmSync(folder, { recursive: true, force: true })
  })
}

export type { ChatContext, ChatMessage }

export {
  chatReplyProcess,
  chatConfig,
  currentModel,
  getModels,
  getList,
  getModelDetail,
  prepareData,
  createModel,
  cancelModel,
  deleteModel,
}
