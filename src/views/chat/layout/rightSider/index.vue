<script setup lang="ts">
import type { SelectGroupOption, SelectOption } from 'naive-ui'
import { NSelect, NTooltip } from 'naive-ui'
import type { VNode } from 'vue'
import { computed, h, onMounted, ref, watch } from 'vue'
import { fetchModels } from '@/api'
import { useAuthStore, useChatStore } from '@/store'

interface ModelItem {
  id: string
  created: number
  object: string
  owned_by: string
  parent?: string
  root: string
}

const defaultModel = 'gpt-3.5-turbo'
const modelOptions = ref<Array<SelectGroupOption | SelectOption>>([])
const modelRenderOption = ({ node, option }: { node: VNode; option: SelectOption }) =>
  h(NTooltip, null, {
    trigger: () => node,
    default: () => `${option.label}`,
  })
const selectedModel = ref('')
const stopSequenceList = ref<string[]>([])

const chatStore = useChatStore()
watch(() => chatStore.active, (curActive) => {
  if (!curActive)
    return
  const curCompletionParams = chatStore.getChatCompletionParamsByUuid(curActive)
  if (curCompletionParams) {
    selectedModel.value = curCompletionParams.model || defaultModel
    stopSequenceList.value = curCompletionParams.stop || []
  }
}, {
  immediate: true,
})
watch(selectedModel, (value) => {
  if (value)
    chatStore.setChatModelByActive(value)
})
watch(stopSequenceList, (value) => {
  if (value?.length)
    chatStore.setChatStopSequenceByActive(value)
})
const hasChat = computed(() => {
  return (chatStore.getActiveChat?.data.length || 0) > 0
})

onMounted(async () => {
  // 本地没有token则不发请求，防止无限刷新
  const authStore = useAuthStore()
  if (!authStore.token)
    return

  const { data } = await fetchModels<ModelItem[]>()
  // 模型列表过滤，只保留v1/chat/completions、v1/completions和模型微调的（即owned_by为user-开头的）
  // 后续再根据openai更新即可
  const filterModelIds = [
    // v1/chat/completions
    'gpt-4', 'gpt-4-0613', 'gpt-4-32k', 'gpt-4-32k-0613', 'gpt-4-vision-preview', 'gpt-4-1106-preview',
    'gpt-3.5-turbo', 'gpt-3.5-turbo-0613', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo-16k-0613',
    // v1/completions
    'text-davinci-003', 'text-davinci-002', 'text-curie-001', 'text-babbage-001', 'text-ada-001',
    'davinci', 'curie', 'babbage', 'ada',
  ]
  const openAiModels = data.filter(item => filterModelIds.includes(item.id))
  const fineTunningModels = data.filter(item => item.owned_by.includes('user-'))
  // 将gpt-3.5-turbo置顶
  const idx = openAiModels.findIndex(item => item.id === defaultModel)
  if (idx > -1) {
    const target = openAiModels.splice(idx, 1)[0]
    openAiModels.unshift(target)
  }
  const options = openAiModels.map((item) => {
    return {
      label: item.id,
      value: item.id,
    }
  }) as Array<SelectGroupOption | SelectOption>
  // 微调的用分组展示
  if (fineTunningModels.length) {
    options.push({
      type: 'group',
      label: 'FINE-TUNES',
      key: 'FINE-TUNES',
      children: fineTunningModels.map(item => ({
        label: item.id,
        value: item.id,
      })),
    })
  }
  modelOptions.value = options
  // 默认选中，加个判断防止回填的值被覆盖
  if (!selectedModel.value)
    selectedModel.value = defaultModel
})
</script>

<template>
  <div class="right-sider">
    <div class="dark:text-[#fff]">
      {{ $t('fineTunes.model') }}:
    </div>
    <NSelect
      v-model:value="selectedModel"
      filterable
      :placeholder="$t('fineTunes.selectModel')"
      :disabled="hasChat"
      :options="modelOptions"
      :render-option="modelRenderOption"
    />
    <div class="mt-8 dark:text-[#fff]">
      Stop Sequence：
    </div>
    <NSelect
      v-model:value="stopSequenceList"
      filterable
      multiple
      tag
      :placeholder="$t('fineTunes.stopSequenceSelectPlaceholder')"
    >
      <template #empty>
        <span>{{ $t('fineTunes.stopSequenceSelectPlaceholder') }}</span>
      </template>
    </NSelect>
  </div>
</template>

<style lang="less" scoped>
.right-sider {
  width: 300px;
  padding: 20px;
}
</style>
