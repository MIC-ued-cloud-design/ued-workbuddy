# 💰 飞鹊价格规范 - AI 友好型

> **版本:** 2026.1  
> **最后更新:** 2026-03-20  
> **来源:** MasterGo 设计文件 (179122910221806)  
> **状态:** ✅ 完整规范已整理

---

## 📋 文档说明

本文档采用 **AI 友好型格式**，特点：
- ✅ 结构化 JSON 数据（便于 AI 解析）
- ✅ 清晰的价格类型和格式定义
- ✅ 完整的多语言规则
- ✅ 包含示例和应用场景

---

## 🎯 价格类型系统

```json
{
  "priceTypes": {
    "tieredPrice": {
      "name": "阶梯价",
      "nameEn": "Tiered Price",
      "description": "根据采购数量设置不同价格档位",
      "displayRules": {
        "singleTier": {
          "condition": "后台设置 1 条阶梯价",
          "display": "固定价格",
          "format": "【US$】+【价格数值】",
          "example": "US$1,003.00",
          "moqDisplay": "【数量】+【空格】+【单位】+【5px 间距】+【(MOQ)】",
          "moqExample": "100 Pieces (MOQ)"
        },
        "multiTier": {
          "condition": "后台设置 2 条及以上阶梯价",
          "display": "设置条数对应的价格",
          "format": "【US$】+【价格数值】",
          "example": "US$15.20",
          "rangeDisplay": "【数量范围】+【空格】+【单位】",
          "rangeExample": "1-99 Pieces"
        }
      }
    },
    "benchmarkPrice": {
      "name": "基准价",
      "nameEn": "Benchmark Price",
      "description": "设置价格基准时展示价格范围",
      "displayRules": {
        "format": "【US$】+【价格数值 a】+【-】+【价格数值 b】",
        "example": "US$15.20-16.60",
        "moqDisplay": "【数量】+【空格】+【单位】+【5px 间距】+【(MOQ)】",
        "moqExample": "100 Pieces (MOQ)",
        "note": "价格 a,b 取基准价格的最小值和最大值"
      }
    },
    "negotiable": {
      "name": "可洽谈",
      "nameEn": "Negotiable",
      "description": "价格可协商，不显示具体金额",
      "displayRules": {
        "display": "Negotiable",
        "moqDisplay": "【数量】+【空格】+【单位】+【5px 间距】+【(MOQ)】",
        "moqExample": "100 Pieces (MOQ)"
      }
    }
  }
}
```

---

## 📐 价格展示样式规范

### 价格样式总览

```json
{
  "priceDisplayStyles": {
    "singlePrice": {
      "name": "单个价格",
      "nameEn": "Single Price",
      "example": "US$1,003.00",
      "moq": "100 Piece (MOQ)",
      "useCase": "阶梯价 1 条",
      "desc": "后台只设置 1 条阶梯价时，展示固定价格"
    },
    "multiPrice": {
      "name": "多价格",
      "nameEn": "Multi Price",
      "examples": ["US$0.464", "US$0.324"],
      "moq": ["1-99 Piece", "100-499 Piece"],
      "useCase": "阶梯价 2 条及以上",
      "desc": "后台设置 2 条及以上阶梯价时，展示对应数量段的价格"
    },
    "priceRange": {
      "name": "基准价",
      "nameEn": "Benchmark Price",
      "example": "US$3.00-76.00",
      "moq": "100 Set (MOQ)",
      "useCase": "基准价",
      "desc": "设置价格基准时，展示最小值 - 最大值的价格区间"
    },
    "negotiable": {
      "name": "可洽谈",
      "nameEn": "Negotiable",
      "example": "Negotiable",
      "moq": "100 Set (MOQ)",
      "useCase": "价格可协商",
      "desc": "卖家设置价格为可洽谈时，不显示具体金额"
    }
  }
}
```

### 展示规则详解

```json
{
  "displayRules": {
    "singlePrice": {
      "name": "单个价格",
      "condition": "后台设置 1 条阶梯价",
      "display": "固定价格",
      "example": "US$1,003.00 / 100 Piece (MOQ)"
    },
    "priceRange_withMultiPrice": {
      "name": "基准价 + 多价格",
      "condition": "同时设置基准价和多条阶梯价",
      "display": "基准价区间 + 阶梯价",
      "example": "US$3.00-76.00 / 100 Set (MOQ)",
      "note": "基准价优先展示，阶梯价在下方"
    },
    "largeNumber_range": {
      "name": "大数字区间",
      "condition": "价格超过 6 位数",
      "display": "截断显示",
      "examples": [
        "US$38,000.00-56,000.00",
        "US$570,722,338.00-0.00-342,398.00..."
      ]
    },
    "largeNumber_truncation": {
      "name": "超大数字截断",
      "condition": "价格过长无法完整展示",
      "display": "末尾加省略号",
      "example": "US$570,722,338.00-0.00-342,398.00..."
    }
  }
}
```

### 展示规则

```json
{
  "displayRules": {
    "priceFormat": {
      "thousandSeparator": ",",
      "decimalPlaces": 2,
      "currencyPosition": "before",
      "currencySymbol": "US$",
      "examples": [
        "US$1,003.00",
        "US$0.464",
        "US$0.324",
        "US$3.00-16.00"
      ]
    },
    "moqFormat": {
      "spacing": "5px",
      "format": "【数量】【空格】【单位】【5px 间距】(MOQ)",
      "examples": [
        "100 Piece (MOQ)",
        "1-99 Piece",
        "100-499 Piece",
        "100 Set (MOQ)"
      ]
    },
    "largeNumberDisplay": {
      "truncationRule": "超过 6 位数字时截断显示",
      "examples": [
        {
          "full": "US$38,000.00-56,000.00",
          "truncated": "US$38,000.00-56,000.00"
        },
        {
          "full": "US$570,722,338.00-0.00-342,398.00...",
          "truncated": "US$570,722,338.00-0.00-342,398.00..."
        }
      ]
    }
  }
}
```

---

## 🌍 多语言价格格式规范

### 语言分组规则

```json
{
  "multiLanguageRules": {
    "group1": {
      "name": "使用点号分隔",
      "languages": [
        {"code": "es", "name": "西班牙语"},
        {"code": "nl", "name": "荷兰语"},
        {"code": "de", "name": "德语"},
        {"code": "it", "name": "意大利语"},
        {"code": "tr", "name": "土耳其语"},
        {"code": "vi", "name": "越南语"},
        {"code": "id", "name": "印度尼西亚语"}
      ],
      "priceFormat": {
        "thousandSeparator": ".",
        "decimalSeparator": ",",
        "example": "1.728.000,11"
      },
      "quantityFormat": {
        "thousandSeparator": ".",
        "example": "10.000"
      },
      "currencyPosition": {
        "es": {"symbol": "US$", "position": "before", "example": "US$1.728.000,11"},
        "nl": {"symbol": "US$", "position": "before", "example": "US$1.728.000,11"},
        "de": {"symbol": "$", "position": "after", "example": "1.728.000,11$"},
        "it": {"symbol": "USD", "position": "after", "example": "1.728.000,11USD"},
        "tr": {"symbol": "$", "position": "before", "example": "$1.728.000,11"},
        "vi": {"symbol": "US$", "position": "after", "example": "1.728.000,11US$"},
        "id": {"symbol": "US$", "position": "before", "example": "US$1.728.000,11"}
      }
    },
    "group2": {
      "name": "使用空格分隔",
      "languages": [
        {"code": "fr", "name": "法语"},
        {"code": "ru", "name": "俄语"},
        {"code": "pt", "name": "葡语"}
      ],
      "priceFormat": {
        "thousandSeparator": " ",
        "decimalSeparator": ",",
        "example": "1 728 000,11"
      },
      "quantityFormat": {
        "thousandSeparator": " ",
        "example": "10 000"
      },
      "currencyPosition": {
        "fr": {"symbol": "$US", "position": "after", "example": "1 728 000,00$US"},
        "ru": {"symbol": "$", "position": "after", "example": "1 728 000,00$"},
        "pt": {"symbol": "US$", "position": "before", "example": "US$1 728 000,11"}
      }
    },
    "group3": {
      "name": "使用逗号分隔",
      "languages": [
        {"code": "sa", "name": "阿拉伯语"},
        {"code": "jp", "name": "日语"},
        {"code": "kr", "name": "韩语"},
        {"code": "th", "name": "泰语"}
      ],
      "priceFormat": {
        "thousandSeparator": ",",
        "decimalSeparator": ".",
        "example": "1,728,000.11"
      },
      "quantityFormat": {
        "thousandSeparator": ",",
        "example": "10,000"
      },
      "currencyPosition": {
        "sa": {"symbol": "$US", "position": "before", "example": "$US1,728,000.00"},
        "jp": {"symbol": "$", "position": "before", "example": "$1,728,000.00"},
        "kr": {"symbol": "US$", "position": "before", "example": "US$1,728,000.00"},
        "th": {"symbol": "US$", "position": "before", "example": "US$1,728,000.11"}
      }
    },
    "group4": {
      "name": "印度语特殊格式",
      "languages": [
        {"code": "hi", "name": "印地语"}
      ],
      "priceFormat": {
        "thousandSeparator": "混合 (百位和千位用\",\"，千位以上每 2 位用\",\")",
        "decimalSeparator": ".",
        "example": "$17,49,95,744.11"
      },
      "quantityFormat": {
        "thousandSeparator": "混合 (百位和千位用\",\",千位以上每 2 位用\",\")",
        "example": "10,00,10,000"
      },
      "currencyPosition": {
        "hi": {"symbol": "$", "position": "before", "example": "$17,49,95,744.11"}
      }
    }
  }
}
```

### 16 种语言完整对照表

```json
{
  "languageMatrix": {
    "total": 16,
    "languages": [
      {"code": "es", "name": "西班牙语", "group": 1, "symbol": "US$", "position": "前"},
      {"code": "nl", "name": "荷兰语", "group": 1, "symbol": "US$", "position": "前"},
      {"code": "de", "name": "德语", "group": 1, "symbol": "$", "position": "后"},
      {"code": "it", "name": "意大利语", "group": 1, "symbol": "USD", "position": "后"},
      {"code": "tr", "name": "土耳其语", "group": 1, "symbol": "$", "position": "前"},
      {"code": "vi", "name": "越南语", "group": 1, "symbol": "US$", "position": "后"},
      {"code": "id", "name": "印度尼西亚语", "group": 1, "symbol": "US$", "position": "前"},
      {"code": "fr", "name": "法语", "group": 2, "symbol": "$US", "position": "后"},
      {"code": "ru", "name": "俄语", "group": 2, "symbol": "$", "position": "后"},
      {"code": "pt", "name": "葡语", "group": 2, "symbol": "US$", "position": "前"},
      {"code": "sa", "name": "阿拉伯语", "group": 3, "symbol": "$US", "position": "前"},
      {"code": "jp", "name": "日语", "group": 3, "symbol": "$", "position": "前"},
      {"code": "kr", "name": "韩语", "group": 3, "symbol": "US$", "position": "前"},
      {"code": "th", "name": "泰语", "group": 3, "symbol": "US$", "position": "前"},
      {"code": "hi", "name": "印地语", "group": 4, "symbol": "$", "position": "前"},
      {"code": "en", "name": "英语", "group": 0, "symbol": "US$", "position": "前"}
    ],
    "positionSummary": {
      "before": ["es", "nl", "tr", "id", "pt", "sa", "jp", "kr", "th", "hi", "en"],
      "after": ["de", "it", "vi", "fr", "ru"]
    }
  }
}
```

### 多语言展示示例

```json
{
  "multiLanguageExamples": {
    "currencyBefore": {
      "name": "价格单位在前",
      "languages": ["荷兰语 (nl)", "英语 (en)", "西班牙语 (es)"],
      "examples": [
        {"lang": "nl", "price": "US$ 3,00", "range": "US$ 3,00-6,00", "large": "US$ 38.000,00-56.000,00"},
        {"lang": "en", "price": "US$3.00", "range": "US$3.00-16.00", "large": "US$22,338,000.00-42,338,000.00"},
        {"lang": "es", "price": "US$3,00", "range": "US$3,00-6,00", "large": "US$38.000,00-56.000,00"}
      ],
      "format": "【货币符号】【价格数值】",
      "note": "货币符号与数值之间可能有空格（如荷兰语）"
    },
    "currencyAfter": {
      "name": "价格单位在后",
      "languages": ["越南语 (vi)", "德语 (de)", "法语 (fr)", "俄语 (ru)"],
      "examples": [
        {"lang": "vi", "price": "3,00 US$", "range": "3,00-6,00 US$", "large": "38.000,00-56.000,00 US$"},
        {"lang": "de", "price": "3,00$", "range": "3,00-6,00$", "large": "38.000,00-56.000,00$"},
        {"lang": "fr", "price": "3,00$US", "range": "3,00-6,00$US", "large": "38 000,00-56 000,00$US"},
        {"lang": "ru", "price": "3,00$", "range": "3,00-6,00$", "large": "38 000,00-56 000,00$"}
      ],
      "format": "【价格数值】【货币符号】",
      "note": "数值与货币符号之间可能有空格"
    },
    "rtl": {
      "name": "从右到左 (RTL)",
      "languages": ["阿拉伯语 (sa)"],
      "examples": [
        {"lang": "sa", "price": "US$3.00", "range": "US$3.00-16.00", "large": "US$22,338,000.00-42,338,000.00", "note": "阿拉伯语文本从右到左排列"}
      ],
      "format": "【货币符号】【价格数值】",
      "note": "整体布局从右到左，但数字仍从左到右"
    }
  }
}
```

---

## 📏 补充说明

### 整数部分规则

```json
{
  "integerRules": {
    "thousandSeparator": {
      "description": "价格/起订量数值大于三位数时，按照英文习惯三位一逗",
      "separator": ",",
      "note": "逗号为英文逗号，不加空格",
      "examples": [
        "US$10,000",
        "100,000 Units (MOQ)"
      ]
    }
  }
}
```

### 小数部分规则

```json
{
  "decimalRules": {
    "precision": {
      "description": "价格字段可保留四位小数",
      "examples": [
        "US$10.1423",
        "US$0.1423"
      ]
    },
    "padding": {
      "description": "小数点后不足两位时，自动用 0 补齐为两位",
      "examples": [
        {"input": "$1", "output": "US$1.00"},
        {"input": "$500.2", "output": "US$500.20"}
      ]
    }
  }
}
```

### MOQ 规则

```json
{
  "moqRules": {
    "format": "统一用 MOQ 表示",
    "valueType": "整数",
    "position": "在产品单位后面",
    "examples": [
      "100 Piece (MOQ)",
      "1-99 Piece",
      "100-499 Piece"
    ]
  }
}
```

### 产品单位规则

```json
{
  "unitRules": {
    "followOnlineRules": true,
    "commonUnits": [
      "Piece",
      "Set",
      "Unit",
      "Pack"
    ],
    "note": "遵循线上现有规则不变"
  }
}
```

### 样式限制

```json
{
  "styleRules": {
    "color": "不限制",
    "fontSize": "不限制",
    "fontStyle": "不限制",
    "note": "以具体需求的视觉稿为准"
  }
}
```

### 技术实现

```json
{
  "implementation": {
    "currencySymbol": {
      "field": "US$",
      "note": "需要和数值分不同的字段存取"
    },
    "value": {
      "field": "数值",
      "note": "用于前端可分别控制样式"
    },
    "spacing": {
      "empty": "代表空格",
      "spacing5px": "代表 5px 间距"
    }
  }
}
```

---

## 📱 多终端适配

```json
{
  "multiTerminal": {
    "platforms": [
      "PC",
      "触屏",
      "APP"
    ],
    "note": "多终端价格显示均以以上规范为准",
    "consistency": "统一 MIC 多终端的产品价格格式",
    "considerations": {
      "PC": {
        "screenWidth": "≥1024px",
        "priceDisplay": "完整展示",
        "fontSize": "14-16px",
        "note": "空间充足，可展示完整价格和 MOQ"
      },
      "touchscreen": {
        "screenWidth": "768-1023px",
        "priceDisplay": "完整展示",
        "fontSize": "14-16px",
        "note": "参考 PC 端，适当调整间距"
      },
      "APP": {
        "screenWidth": "<768px",
        "priceDisplay": "可能截断",
        "fontSize": "12-14px",
        "note": "空间有限，大数字可能需要截断显示"
      }
    }
  }
}
```

---

## 🎨 视觉设计规范

### 价格视觉层次

```json
{
  "visualHierarchy": {
    "price": {
      "importance": "高",
      "fontSize": "较大",
      "fontWeight": "Regular/Bold",
      "color": "主色/强调色",
      "note": "价格是用户最关注的信息，需要突出显示"
    },
    "moq": {
      "importance": "中",
      "fontSize": "较小",
      "fontWeight": "Regular",
      "color": "辅助色",
      "note": "MOQ 作为补充信息，字号小于价格"
    },
    "tierLabels": {
      "importance": "中",
      "fontSize": "小",
      "fontWeight": "Regular",
      "color": "辅助色",
      "note": "阶梯价数量段标签，如'1-99 Piece'"
    }
  }
}
```

### 间距规范

```json
{
  "spacingRules": {
    "currencyAndPrice": {
      "description": "货币符号与价格数值之间",
      "value": "无间距 或 1 个字符空格",
      "examples": ["US$1,003.00", "US$ 3,00 (荷兰语)"]
    },
    "priceAndMOQ": {
      "description": "价格与 MOQ 之间",
      "value": "换行 或 适当间距",
      "note": "通常分两行显示"
    },
    "moqValueAndUnit": {
      "description": "MOQ 数值与单位之间",
      "value": "1 个空格",
      "example": "100 Piece"
    },
    "unitAndMOQLabel": {
      "description": "单位与 (MOQ) 标签之间",
      "value": "5px",
      "example": "100 Piece (MOQ)"
    },
    "tierPrices": {
      "description": "多个阶梯价之间",
      "value": "适当垂直间距",
      "note": "每个阶梯价独立成行或卡片"
    }
  }
}
```

### 截断规则

```json
{
  "truncationRules": {
    "priceRange": {
      "condition": "价格区间过长",
      "rule": "保留完整区间，超出容器宽度时末尾加省略号",
      "example": "US$570,722,338.00-0.00-342,398.00..."
    },
    "multiTier": {
      "condition": "阶梯价数量过多",
      "rule": "展示前 N 条，末尾加'...'或'查看更多'",
      "example": "US$0.464 (1-99), US$0.324 (100-499)..."
    },
    "largeNumbers": {
      "condition": "数字超过 6 位",
      "rule": "完整展示千分位，超出容器时截断",
      "note": "优先保证数字完整性，其次考虑截断"
    }
  }
}
```

---

## 🔧 AI 使用指南

### 查询价格格式

```
查询格式：
- "阶梯价怎么显示"
- "基准价的格式是什么"
- "可洽谈价格如何展示"
- "西班牙语的价格格式"
- "荷兰语的价格示例"
```

### 查询多语言规则

```
查询格式：
- "法语的价格分隔符用什么"
- "德语的货币符号在前还是在后"
- "显示所有语言的货币位置"
- "印地语的特殊格式是什么"
- "哪些语言货币符号在后"
```

### 查询展示规则

```
查询格式：
- "大数字怎么截断"
- "MOQ 的格式规范"
- "价格和 MOQ 的间距是多少"
- "阶梯价最多展示几条"
```

### 生成价格显示代码

```
生成请求：
- "生成 US$ 价格的格式化函数"
- "生成西班牙语价格格式化代码"
- "生成 MOQ 显示的 React 组件"
- "生成 16 种语言价格格式化配置"
- "生成价格截断的 CSS 样式"
```

### 示例代码请求

```json
{
  "examples": [
    "生成 JavaScript 价格格式化函数，支持 16 种语言",
    "生成 React 组件展示阶梯价",
    "生成 Vue 组件展示多语言价格",
    "生成 CSS 样式处理价格截断",
    "生成 TypeScript 类型定义"
  ]
}
```

---

## 📊 统计数据

```json
{
  "statistics": {
    "priceTypes": 3,
    "languages": 16,
    "languageGroups": 4,
    "currencySymbols": 4,
    "thousandSeparators": 3,
    "decimalSeparators": 2,
    "platforms": 3
  }
}
```

---

## 📝 版本历史

```json
{
  "versionHistory": [
    {
      "version": "1.1",
      "date": "2026-03-20",
      "title": "补充视觉规范和展示规则",
      "changes": [
        "补充价格展示规则详解",
        "添加多语言展示示例（货币在前/在后/RTL）",
        "添加视觉层次规范（价格/MOQ/阶梯标签）",
        "添加间距规范（货币/价格/MOQ 之间）",
        "添加截断规则（价格区间/阶梯价/大数字）",
        "添加多终端适配考虑",
        "完善 AI 使用指南"
      ]
    },
    {
      "version": "1.0",
      "date": "2026-03-20",
      "title": "初始版本",
      "changes": [
        "整理价格显示样式规范",
        "整理美元价格单位格式统一规范",
        "整理 16 种语言价格格式规则",
        "生成 AI 友好型文档"
      ],
      "source": "MasterGo (179122910221806)"
    }
  ]
}
```

---

## 💡 关键洞察

### 1. 价格格式的核心原则

> **统一性 + 本地化 = 全球化体验**

- **统一性**：所有语言使用相同的价格结构（货币 + 数值+MOQ）
- **本地化**：尊重各地区的数字格式习惯（分隔符、货币位置）
- **一致性**：PC/触屏/APP 多终端统一规范

### 2. 分隔符的三种体系

```
体系 1（点号）：1.728.000,11 - 欧洲大陆（西/荷/德/意/土/越/印尼）
体系 2（空格）：1 728 000,11 - 法语区（法/俄/葡）
体系 3（逗号）：1,728,000.11 - 英美亚（英/阿/日/韩/泰）
特殊：印度混合制 - $17,49,95,744.11
```

### 3. 货币位置的规律

```
货币在前 (11 种)：英语、西班牙语、荷兰语、土耳其语、印尼语、
                  葡语、阿语、日语、韩语、泰语、印地语
货币在后 (5 种)：德语、意大利语、越南语、法语、俄语
```

### 4. 技术实现建议

```json
{
  "implementation": {
    "dataStructure": {
      "currency": "独立字段存储（如'US$'）",
      "value": "独立字段存储（如 1003.00）",
      "locale": "语言区域代码（如'en-US'）",
      "note": "前端根据 locale 动态格式化"
    },
    "formatting": {
      "library": "Intl.NumberFormat",
      "fallback": "自定义格式化函数",
      "note": "优先使用浏览器原生 API"
    },
    "testing": {
      "coverage": "16 种语言全覆盖测试",
      "edgeCases": ["大数字", "小数", "零值", "负值"],
      "note": "特别注意印地语特殊格式"
    }
  }
}
```

---

## ⚠️ 注意事项

### 常见错误

```json
{
  "commonMistakes": [
    {
      "error": "混淆分隔符",
      "example": "1,728.00 (错误) vs 1.728,00 (正确，德语)",
      "fix": "根据语言代码选择正确的分隔符"
    },
    {
      "error": "货币位置错误",
      "example": "$3,00 (错误，德语) vs 3,00$ (正确，德语)",
      "fix": "根据语言代码确定货币前后位置"
    },
    {
      "error": "印地语格式特殊",
      "example": "$1,749,957.44 (错误) vs $17,49,95,744.11 (正确)",
      "fix": "印地语千位以上每 2 位分隔，不是 3 位"
    },
    {
      "error": "MOQ 格式不统一",
      "example": "100 件 (MOQ) vs 100 Piece (MOQ)",
      "fix": "统一使用英文单位 + (MOQ) 格式"
    }
  ]
}
```

### 边界情况处理

```json
{
  "edgeCases": {
    "zeroPrice": {
      "display": "US$0.00 或 Negotiable",
      "note": "根据业务逻辑决定"
    },
    "negativePrice": {
      "display": "理论上不应出现，需前端校验",
      "note": "后端应限制价格≥0"
    },
    "extremeLarge": {
      "display": "US$999,999,999.00...",
      "note": "超过容器宽度时截断 + 省略号"
    },
    "extremeSmall": {
      "display": "US$0.0001",
      "note": "支持 4 位小数，但显示时可能只展示 2 位"
    },
    "missingMOQ": {
      "display": "仅显示价格，不显示 MOQ 行",
      "note": "MOQ 为可选展示"
    }
  }
}
```

---

_文档生成时间：2026-03-20_  
_最后同步：MasterGo v1.0_  
_文档格式：AI 友好型 (JSON + Markdown 混合)_
