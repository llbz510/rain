# M15 — 数据持久化

> 状态：v5.0 已确认（第十次会话，决策84，完整 schema + 目录 + 加密 + 中断恢复）

## 目录结构

Tauri 应用数据目录下：

```
Rain/
├── rain.db                 # SQLite 主库
├── config.json             # 非敏感设置（排序、窗口尺寸等）
├── videos/<videoId>/       # 在线视频下载文件
├── thumbnails/<videoId>.jpg
└── whisper-models/         # 本地 Whisper 模型
```

- 本地视频**引用原路径**（不复制到 app 目录）；原文件移走→列表标"文件缺失"（决策84）
- 在线视频下载到 `videos/<videoId>/`
- 删视频保留本地视频文件（决策60），仅删 DB + 缩略图

## SQLite Schema

### 设计要点

- 章节章节/小节/段落统一一张 `node` 表，`kind` 列区分，`parent_id` 自引用成树（支持不限深度，决策4）
- API Key **不加密**，明文存 `setting` 表（决策84；个人工具，用户接受风险）
- 派生相关表 v2 预留

### 表结构

**video** — 视频元信息
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 视频唯一 id |
| title | TEXT | 标题 |
| source | TEXT | 'local' \| 'url' |
| source_url | TEXT | 在线 URL（可空） |
| file_path | TEXT | 本地文件路径（可空） |
| thumbnail | TEXT | 缩略图路径 |
| duration | REAL | 时长（秒） |
| language | TEXT | 'zh' \| 'en' \| 'other' |
| status | TEXT | 'pending' \| 'processing' \| 'ready' \| 'failed' \| 'cancelled'（决策83 加 cancelled） |
| stage | TEXT | 处理阶段：'asr' \| 'stage2' \| 'merging'（中断恢复用） |
| error_message | TEXT | 失败原因（可空） |
| created_at | INTEGER | 创建时间 |
| position | REAL | 最远到达秒数（持久单调，列表进度条 + 重开续播） |
| last_studied_at | INTEGER | 最近学习时间（列表排序） |

**node** — 段落树（统一表，kind 区分层级）
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 节点唯一 id |
| video_id | TEXT FK→video | 所属视频 |
| parent_id | TEXT FK→node | 父节点（章/节为 null 或上级容器；自引用成树） |
| kind | TEXT | 'chapter' \| 'section' \| 'paragraph' |
| title | TEXT | 节点标题 |
| type | TEXT | 段落类型：'concept' \| 'example' \| 'analogy' \| 'transition'（非段落为 null） |
| start_time | REAL | 起始时间（秒） |
| end_time | REAL | 结束时间（秒） |
| text | TEXT | 原始转录文本（由 sentences 拼接，Path B） |
| translation | TEXT | 中文翻译（仅英文视频，可空） |
| sort_order | INTEGER | 同级排序 |

**sentence** — 句子（引用原子单位，永不删）
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 句子唯一 id |
| node_id | TEXT FK→node | 所属段落 |
| text | TEXT | 句子文本 |
| start_time | REAL | 起始时间（秒） |
| end_time | REAL | 结束时间（秒） |
| sort_order | INTEGER | 段落内排序 |

**note** — 笔记（统一实体，source 区分来源）
| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 笔记唯一 id |
| video_id | TEXT FK→video | 所属视频 |
| content | TEXT | 可编辑文本 |
| source | TEXT | 'excerpt' \| 'user' \| 'ai' |
| created_at | INTEGER | 创建时间 |
| derivation_id | TEXT | 预留 v2 |
| sort_order | INTEGER | 排序 |

**note_sentence** — 笔记↔句子多对多（对应 Note.sentenceIds）
| 列 | 类型 | 说明 |
|----|------|------|
| note_id | TEXT FK→note | 笔记 |
| sentence_id | TEXT FK→sentence | 句子 |

**setting** — 设置（含 API Key 明文）
| 列 | 类型 | 说明 |
|----|------|------|
| key | TEXT PK | 键名（如 `api_key.<模型别名>`） |
| value | TEXT | 值（API Key 为明文，决策84） |

**derivation / derivation_node** — v2 预留，v1 不建

## API Key 存储

- **不加密**，明文存 SQLite `setting` 表（决策84）
- 键名格式：`api_key.<模型别名>`
- 代价：能读到 rain.db 的人/程序能看到 Key；个人工具用户接受
- （原 M19"SQLite 或加密文件"措辞据此更新为"明文存 SQLite"）

## 中断恢复

落实决策30，基于 `video.stage` 字段：

1. **ASR 原子持久化**：ASR 完成后一次性写入全部 sentences（完整或不存在，绝不存一半）
2. **中断重开逻辑**：
   - 有完整 ASR 结果 → 跳过 ASR，重跑 Stage 2（省掉最久的十几分钟）
   - 无 ASR 结果 → 重跑 ASR
   - Stage 2 某块中断 → 重跑该块（M18 分块机制）
3. **加载时校验** ASR 结果完整性，坏了重跑

## 撤销栈（决策83）

- 结构编辑轻量撤销栈：`Ctrl+Z`，会话内（不跨会话持久），最近 ~20 步
- 每个操作记逆操作（删=迁回／合并=拆开／拆=合并／reparent=移回／重命名=原名／改类型=原类型）
- `Ctrl+Y` 重做可选
- 跨会话不保留（重启清空）；深层恢复仍靠决策15"再拆"
