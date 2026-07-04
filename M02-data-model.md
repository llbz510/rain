# M02 — 数据模型

## 段落树结构

数据模型为树形，支持不限深度。AI 默认产出 3 层（章节>小节>段落），用户可手动拖拽加深。

**为何不限深度**：长视频内容可能超出 3 层结构所需。手动加深用于追加**容器层级**（章节/小节），并非拆分段落。段落恒为叶子节点；用户新划的段落归属到上一级小节，不增加深度。

```
视频(Video)
 └── 章节(Chapter)        — 容器节点，有标题，无类型
      └── 小节(Section)   — 容器节点，有标题，无类型
           └── 段落(Paragraph) — 叶子节点，有标题+类型+文本+时间范围
```

- **容器节点**（章节/小节）：有标题，无类型，可嵌套
- **叶子节点**（段落）：有标题、类型、文本、时间范围
- "章节/小节/段落"是不同深度的角色名，数据模型不锁死层数

## 段落类型（4种）

| 类型 | 说明 | 颜色（M13 决策66 定稿） |
|------|------|-------------|
| 概念描述 | 描述一个概念/知识点 | 蓝 |
| 例子 | 用具体案例演示概念 | 绿 |
| 类比 | 用类比帮助理解概念 | 橙 |
| 过渡 | 段落间的连接/转换内容 | 灰 |

> 与渐构的差异：渐构有 6 种（+自定义+标题）。Rain 砍 4 种，标题改为结构性属性（所有节点都有标题），不作为段落类型。

## 段落字段

```typescript
interface Paragraph {
  id: string
  parentId: string          // 父节点（章节或小节）
  title: string             // AI 生成的段落名称
  type: 'concept' | 'example' | 'analogy' | 'transition'
  text: string              // 原始转录文本（不清洗，不含 LaTeX/代码）。由 sentences 拼接而成（Path B：LLM 输出只存 sentences，app 拼出 text 入库）
  translation?: string       // 中文翻译（仅英文视频有；原文+翻译并存，不替换 text/sentences）
  startTime: number         // 段落起始时间（秒）
  endTime: number           // 段落结束时间（秒）
  sentences: Sentence[]     // 逐句时间戳（句子永不删，是引用的原子单位）
  notes: Note[]             // 关联的笔记（含摘注创建的，按 source 过滤）
}

interface Sentence {
  id: string               // 句子唯一 id（笔记引用的原子单位，永不删除）
  text: string
  startTime: number        // 句子起始时间（秒）
  endTime: number          // 句子结束时间（秒）
}
```

## 笔记（Note）— 统一实体

摘注与随记合并为一个 Note 实体，用 `source` 区分来源。摘注是一个**动作**（点击摘注按钮 / 按 ` 键），动作的结果是创建一条 Note。

```typescript
interface Note {
  id: string
  videoId: string
  sentenceIds: string[]              // 引用的句子（数组，支持多引用/空数组=视频级笔记）。句子永不删，引用跨合并/拆分/重排全有效
  content: string                     // 可编辑文本（摘注创建时初始为空）
  source: 'excerpt' | 'user' | 'ai'   // 来源：摘注创建 / 用户手写 / AI回答存入
  createdAt: number
  derivationId?: string               // 预留：未来归属哪个派生（v2）
}
```

**三种来源的初始状态：**

| source | 怎么来的 | 初始 content | 初始 sentenceIds |
|--------|---------|-------------|------------------|
| `'excerpt'` | 点摘注按钮 / 按 ` 键 | 空 | [被摘注段落的全部句子] |
| `'user'` | 用户在随记面板新建 | 空 | [] |
| `'ai'` | AI 回答手动存入随记 | AI 回答全文 | [关联段落的句子]（可选） |

**设计要点：**
- 不存文本快照：笔记只存句子引用（`sentenceIds`），点击引用跳回看对应句子的当前文本。句子永不删，跨合并/拆分/重排/删除（内容迁移）后引用仍指向对应句子，永远有效（决策18）
- 所有笔记均可编辑内容、均可添加更多句子引用，与 source 无关
- 所有笔记均可编辑内容、均可添加更多段落引用，与 source 无关。
- 原 Excerpt 实体已删除；原 `annotation` 字段被 `content` 取代。

## 派生（Derivation）— 低优先级，v1 预留字段

```typescript
interface Derivation {
  id: string
  title: string
  description: string
  nodes: DerivationNode[]   // 导图节点
  createdAt: number
}

interface DerivationNode {
  id: string
  noteId?: string          // 引用笔记（原 excerptId 已删除，Excerpt 合并入 Note）
  parentId?: string        // 导图中的父节点
}
```

## 视频

```typescript
interface Video {
  id: string
  title: string
  source: 'local' | 'url'
  sourceUrl?: string        // 在线URL
  filePath?: string         // 本地文件路径
  thumbnail: string         // 原视频缩略图（不做统计封面）
  duration: number
  language: 'zh' | 'en' | 'other'
  status: 'pending' | 'processing' | 'ready' | 'failed'
  createdAt: number
  position: number              // 最远到达秒数（持久，单调）。用于列表卡进度条 + 重开自动续播。M05 目录■/□ 不用它（■/□ 是瞬时当前位置指示，见 M05）
  lastStudiedAt: number         // 最近一次打开/播放时间，用于列表"最近学习"排序
}
```
