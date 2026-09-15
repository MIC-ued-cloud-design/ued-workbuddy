# 📐 飞鹊响应式规则 - AI 友好型规范

> **版本:** 2026.1  
> **最后更新:** 2026-03-20  
> **来源:** MasterGo 设计文件 (173710778459969) + 飞鹊组件规范 (Xzr3X0m5nRI9i66LNiOfGi)  
> **页面:** MIC-WEB 适配断点规范说明  
> **状态:** ✅ 已与飞鹊组件设计令牌对齐

---

## 📋 文档说明

本文档采用 **AI 友好型格式**，特点：
- ✅ 结构化 JSON 数据（便于 AI 解析）
- ✅ 清晰的断点和布局规则定义
- ✅ 完整的元素变化对照表
- ✅ 包含模块适配示例

---

## 🎨 设计令牌对齐

### 与飞鹊组件规范统一的设计令牌

```json
{
  "designTokens": {
    "source": "飞鹊组件 AI 友好型规范 (2026.1)",
    "spacing": {
      "base": 4,
      "scale": "4px 基准",
      "tokens": [
        { "name": "xxs", "value": 4, "rem": "0.25rem" },
        { "name": "xs", "value": 8, "rem": "0.5rem" },
        { "name": "s", "value": 12, "rem": "0.75rem" },
        { "name": "m", "value": 16, "rem": "1rem" },
        { "name": "l", "value": 24, "rem": "1.5rem" },
        { "name": "xl", "value": 32, "rem": "2rem" },
        { "name": "2xl", "value": 48, "rem": "3rem" }
      ],
      "responsiveNote": "响应式间距优先使用 4px 倍数，断点间变化按 4px 阶梯调整"
    },
    "typography": {
      "fontFamily": "'Roboto', 'Arial', 'Microsoft YaHei', sans-serif",
      "fontWeight": {
        "regular": 400,
        "bold": 700,
        "note": "仅使用 400 和 700 两种字重"
      },
      "fontSize": [
        { "name": "title36", "size": 36, "lineHeight": 42, "responsiveBreakpoint": "≥1440" },
        { "name": "title32", "size": 32, "lineHeight": 38, "responsiveBreakpoint": "≥1366" },
        { "name": "title24", "size": 24, "lineHeight": 30, "responsiveBreakpoint": "≥1280" },
        { "name": "title22", "size": 22, "lineHeight": 28, "responsiveBreakpoint": "≥1280" },
        { "name": "title18", "size": 18, "lineHeight": 26, "responsiveBreakpoint": "≥1024" },
        { "name": "title16", "size": 16, "lineHeight": 24, "responsiveBreakpoint": "≥768" },
        { "name": "body", "size": 14, "lineHeight": 22, "responsiveBreakpoint": "全断点通用" },
        { "name": "caption", "size": 12, "lineHeight": 18, "responsiveBreakpoint": "≥768" }
      ],
      "responsiveNote": "正文字号 14px 全断点通用，标题按断点阶梯式变化"
    },
    "borderRadius": {
      "tokens": [
        { "name": "xxs", "value": "2px" },
        { "name": "xs", "value": "4px" },
        { "name": "s", "value": "8px" },
        { "name": "m", "value": "12px" },
        { "name": "l", "value": "16px" },
        { "name": "xl", "value": "24px" },
        { "name": "full", "value": "9999px" }
      ],
      "responsiveNote": "圆角不随断点变化，保持统一"
    }
  }
}
```

---

## 🎯 核心响应式策略

### 混合布局模式

```json
{
  "layoutStrategy": {
    "name": "混合布局",
    "description": "结合多种组合方式，保持简单轻巧，同一断点内保持统一逻辑",
    "modes": [
      {
        "name": "拉伸布局",
        "type": "stretch",
        "description": "元素宽度随容器变化而拉伸",
        "useCase": "通栏、等分结构"
      },
      {
        "name": "等比缩放",
        "type": "scale",
        "description": "元素按比例缩放",
        "useCase": "图片、图标等比例内容"
      },
      {
        "name": "扩展布局",
        "type": "expand",
        "description": "增加元素数量或间距",
        "useCase": "列表项、卡片数量调整"
      },
      {
        "name": "固定布局",
        "type": "fixed",
        "description": "元素尺寸保持不变",
        "useCase": "固定宽度内容区"
      }
    ],
    "principle": "一般通栏、等分结构适合弹性布局，非等分多栏结构采用混合布局",
    "designTokensAlignment": "间距变化遵循 4px 基准系统，优先使用 xxs/xs/s/m/l/xl/2xl 令牌"
  }
}
```

---

## 📱 断点系统 (Breakpoints)

### 设备分辨率占比

```json
{
  "deviceResolution": {
    "top3Desktop": [
      {"rank": 1, "resolution": "1920x1080", "percentage": 45.92},
      {"rank": 2, "resolution": "1366x768", "percentage": 12.71},
      {"rank": 3, "resolution": "1440x900", "percentage": 9.95}
    ],
    "top3All": [
      {"rank": 1, "resolution": "1920x1080", "percentage": 35.72},
      {"rank": 2, "resolution": "1440x900", "percentage": 15.78},
      {"rank": 3, "resolution": "1366x768", "percentage": 14.86}
    ]
  }
}
```

### 常用断点（内容区）- 已对齐飞鹊组件规范

```json
{
  "breakpoints": {
    "common": {
      "type": "常用断点",
      "category": "内容区",
      "device": "PC",
      "designTokensAligned": true,
      "note": "字号已调整为飞鹊组件标准字号系统 (12/14/16/18/22/24/32/36)",
      "values": [
        {
          "breakpoint": 1920,
          "contentWidth": 1440,
          "range": "1440 → 1920",
          "fontSize": {
            "body": 14,
            "title": 32,
            "titleLarge": 36,
            "note": "飞鹊标准：title32(32px)/title36(36px)"
          },
          "specialFontSize": {
            "price": 32,
            "highlight": 36,
            "note": "价格/重点标题用飞鹊标准字号"
          },
          "margin": {"min": 16, "max": 32, "tokens": "m(16)/xl(32)", "note": "4px 倍数"},
          "padding": {"min": 16, "max": 32, "tokens": "m(16)/xl(32)", "note": "4px 倍数"}
        },
        {
          "breakpoint": 1366,
          "contentWidth": 1326,
          "range": "1366 → 1439",
          "fontSize": {
            "body": 14,
            "title": 24,
            "titleLarge": 32,
            "note": "飞鹊标准：title24(24px)/title32(32px)"
          },
          "specialFontSize": {
            "price": 24,
            "highlight": 32,
            "note": "价格/重点标题用飞鹊标准字号"
          },
          "margin": {"min": 16, "max": 24, "tokens": "m(16)/l(24)", "note": "4px 倍数"},
          "padding": {"min": 16, "max": 24, "tokens": "m(16)/l(24)", "note": "4px 倍数"}
        },
        {
          "breakpoint": 1280,
          "contentWidth": 1240,
          "range": "1280 → 1365",
          "fontSize": {
            "body": 14,
            "title": 22,
            "titleLarge": 24,
            "note": "飞鹊标准：title22(22px)/title24(24px)"
          },
          "specialFontSize": {
            "price": 22,
            "highlight": 24,
            "note": "价格/重点标题用飞鹊标准字号"
          },
          "margin": {"min": 12, "max": 24, "tokens": "s(12)/l(24)", "note": "4px 倍数"},
          "padding": {"min": 12, "max": 24, "tokens": "s(12)/l(24)", "note": "4px 倍数"}
        },
        {
          "breakpoint": 1024,
          "contentWidth": 984,
          "range": "1024 → 1279",
          "fontSize": {
            "body": 14,
            "title": 18,
            "titleLarge": 22,
            "note": "飞鹊标准：title18(18px)/title22(22px)"
          },
          "specialFontSize": {
            "price": 18,
            "highlight": 22,
            "note": "价格/重点标题用飞鹊标准字号"
          },
          "margin": {"min": 12, "max": 16, "tokens": "s(12)/m(16)", "note": "4px 倍数"},
          "padding": {"min": 12, "max": 16, "tokens": "s(12)/m(16)", "note": "4px 倍数"}
        },
        {
          "breakpoint": 768,
          "contentWidth": 728,
          "range": "768 → 1023",
          "fontSize": {
            "body": 14,
            "title": 18,
            "titleLarge": 22,
            "note": "飞鹊标准：title18(18px)/title22(22px)"
          },
          "specialFontSize": {
            "price": 18,
            "highlight": 22,
            "note": "价格/重点标题用飞鹊标准字号"
          },
          "margin": {"min": 12, "max": 24, "tokens": "s(12)/l(24)", "note": "4px 倍数"},
          "padding": {"min": 12, "max": 24, "tokens": "s(12)/l(24)", "note": "4px 倍数"}
        }
      ]
    },
    "mobile": {
      "type": "移动端",
      "breakpoint": 375,
      "note": "遵循移动端 WAP 规范",
      "reference": "遵循移动端规范",
      "fontSize": {
        "body": 14,
        "title": 18,
        "caption": 12,
        "note": "飞鹊标准：body(14px)/title18(18px)/caption(12px)"
      }
    }
  }
}
```

### 特殊断点（内容区）

```json
{
  "breakpoints": {
    "special": {
      "type": "特殊断点",
      "category": "内容区",
      "values": [
        {
          "name": "内容区 1",
          "width": 1840,
          "viewport": 1920,
          "description": "1920 断点下的内容区尺寸为 1840，但有特殊场景下可选择 1440 内容区",
          "useCase": "大屏展示场景"
        },
        {
          "name": "内容区 2",
          "width": 1440,
          "viewport": 1920,
          "description": "1920 断点下的标准内容区",
          "useCase": "标准 PC 场景"
        },
        {
          "name": "内容区 3",
          "width": 1200,
          "viewport": 1920,
          "description": "1200px 可以作为 1920/1440/1366/1280 等四个断点下的内容区",
          "useCase": "保守型设计，兼容多个断点"
        }
      ],
      "note": "1200 以下分辨率，中间通道尽量建议以小屏点为主；1280 以上的分辨率，中间通道尽量建议以大屏点为主"
    }
  }
}
```

### 断点完整列表

```json
{
  "allBreakpoints": {
    "PC": [
      {"viewport": 1920, "content": 1440},
      {"viewport": 1480, "content": 1440},
      {"viewport": 1366, "content": 1326},
      {"viewport": 1280, "content": 1240},
      {"viewport": 1024, "content": 984},
      {"viewport": 768, "content": 728}
    ],
    "Pad": [
      {"viewport": 1024, "content": 984},
      {"viewport": 768, "content": 728}
    ],
    "Mobile": [
      {"viewport": 375, "content": "遵循 WAP 规范"}
    ]
  }
}
```

---

## 📏 元素变化对照表

### 完整对照表（已对齐飞鹊组件规范）

```json
{
  "elementChanges": {
    "title": "各断点下的元素变化对照表",
    "note": "已按飞鹊组件规范调整字号和间距系统",
    "designTokens": {
      "fontSize": "飞鹊标准字号：12/14/16/18/22/24/32/36",
      "spacing": "飞鹊标准间距：4px 基准 (xxs=4/xs=8/s=12/m=16/l=24/xl=32/2xl=48)"
    },
    "columns": ["断点", "区间", "字号 (飞鹊标准)", "外边距 Margin(4px 倍数)", "内边距 Padding(4px 倍数)"],
    "rows": [
      {
        "breakpoint": 1920,
        "range": "1440 → 1920",
        "fontSize": "body=14, title=32/36",
        "specialFont": "价格/标题：title32(32px)/title36(36px)",
        "margin": "m(16) ~ xl(32)",
        "padding": "m(16) ~ xl(32)"
      },
      {
        "breakpoint": 1366,
        "range": "1366 → 1439",
        "fontSize": "body=14, title=24/32",
        "specialFont": "价格/标题：title24(24px)/title32(32px)",
        "margin": "m(16) ~ l(24)",
        "padding": "m(16) ~ l(24)"
      },
      {
        "breakpoint": 1280,
        "range": "1280 → 1365",
        "fontSize": "body=14, title=22/24",
        "specialFont": "价格/标题：title22(22px)/title24(24px)",
        "margin": "s(12) ~ l(24)",
        "padding": "s(12) ~ l(24)"
      },
      {
        "breakpoint": 1024,
        "range": "1024 → 1279",
        "fontSize": "body=14, title=18/22",
        "specialFont": "价格/标题：title18(18px)/title22(22px)",
        "margin": "s(12) ~ m(16)",
        "padding": "s(12) ~ m(16)"
      },
      {
        "breakpoint": 768,
        "range": "768 → 1023",
        "fontSize": "body=14, title=18/22",
        "specialFont": "价格/标题：title18(18px)/title22(22px)",
        "margin": "s(12) ~ l(24)",
        "padding": "s(12) ~ l(24)"
      },
      {
        "breakpoint": 375,
        "range": "< 768",
        "fontSize": "body=14, title=18, caption=12",
        "specialFont": "价格/标题：title18(18px)",
        "margin": "s(12) ~ m(16)",
        "padding": "s(12) ~ m(16)"
      }
    ],
    "keyChanges": [
      "字号：从连续范围 (15-28px) 改为飞鹊标准字号阶梯 (12/14/16/18/22/24/32/36)",
      "间距：从任意值改为 4px 倍数，使用飞鹊间距令牌 (xxs/xs/s/m/l/xl/2xl)",
      "字重：统一使用 400(Regular) 和 700(Bold) 两种"
    ]
  }
}
```

---

## 🧩 模块适配规则

### 左右结构模块

```json
{
  "moduleAdaptation": {
    "type": "左右结构",
    "description": "常见模块的适配示例 - 左右结构",
    "breakpoints": [
      {
        "viewport": "1920→1480",
        "contentWidth": 1440,
        "leftRatio": "48%",
        "rightRatio": "52%",
        "layout": "两栏布局"
      },
      {
        "viewport": 1366,
        "contentWidth": 1326,
        "leftRatio": "48%",
        "rightRatio": "52%",
        "layout": "两栏布局"
      },
      {
        "viewport": 1280,
        "contentWidth": 1240,
        "leftRatio": "50%",
        "rightRatio": "50%",
        "layout": "等分两栏"
      },
      {
        "viewport": 1024,
        "contentWidth": 984,
        "leftRatio": "52%",
        "rightRatio": "48%",
        "layout": "两栏布局"
      },
      {
        "viewport": 768,
        "contentWidth": 728,
        "leftRatio": "100%",
        "rightRatio": "0%",
        "layout": "单栏堆叠"
      }
    ]
  }
}
```

### 产品卡片模块

```json
{
  "moduleAdaptation": {
    "type": "产品卡片",
    "description": "产品卡片（极简无边样式）- MIC 通栏内容区卡片样式及不同卡点适配",
    "layout": "卡片网格",
    "features": [
      "极简无边样式",
      "通栏内容区",
      "自适应卡片数量"
    ],
    "adaptation": {
      "1920": {"columns": 6, "cardWidth": "自适应"},
      "1440": {"columns": 5, "cardWidth": "自适应"},
      "1366": {"columns": 4, "cardWidth": "自适应"},
      "1280": {"columns": 4, "cardWidth": "自适应"},
      "1024": {"columns": 3, "cardWidth": "自适应"},
      "768": {"columns": 2, "cardWidth": "自适应"},
      "375": {"columns": 1, "cardWidth": "100%"}
    }
  }
}
```

### Banner 模块

```json
{
  "moduleAdaptation": {
    "type": "Banner",
    "description": "常规模块 - banner 适配示例",
    "variants": [
      {
        "name": "固定比例",
        "type": "fixed-ratio",
        "description": "保持固定宽高比",
        "useCase": "品牌 Banner、活动 Banner"
      },
      {
        "name": "固定高度",
        "type": "fixed-height",
        "description": "高度固定，宽度自适应",
        "useCase": "通栏 Banner"
      },
      {
        "name": "自适应",
        "type": "responsive",
        "description": "根据容器自适应",
        "useCase": "内容区 Banner"
      }
    ],
    "adaptation": {
      "1920": {"width": "100%", "height": "自适应"},
      "1440": {"width": "100%", "height": "自适应"},
      "1366": {"width": "100%", "height": "自适应"},
      "1280": {"width": "100%", "height": "自适应"},
      "1024": {"width": "100%", "height": "自适应"},
      "768": {"width": "100%", "height": "自适应"},
      "375": {"width": "100%", "height": "自适应"}
    }
  }
}
```

---

## 🎨 设计原则

### 核心原则

```json
{
  "designPrinciples": {
    "principle1": {
      "name": "简单轻巧",
      "description": "结合多种组合方式，但原则上尽可能保持简单轻巧"
    },
    "principle2": {
      "name": "统一逻辑",
      "description": "同一断点内保持统一逻辑"
    },
    "principle3": {
      "name": "避免复杂",
      "description": "页面实现太过复杂也会影响整体体验和页面性能"
    },
    "principle4": {
      "name": "布局选择",
      "description": "一般通栏、等分结构适合采用弹性布局方式，非等分的多栏结构布局则需要采用混合布局的实现方式"
    },
    "reference": {
      "name": "Ant Design",
      "approach": "拉伸布局 + 扩展布局 + 分栏布局 + 固定布局"
    }
  }
}
```

### 断点选择建议

```json
{
  "breakpointSelection": {
    "designRecommendation": {
      "contentRich": {
        "scenario": "如果页面内容较多，布局较复杂",
        "breakpoints": [1440, 1280, 1024],
        "note": "可以只考虑 3 个核心断点"
      },
      "contentSimple": {
        "scenario": "如果页面内容较少",
        "breakpoints": [1440, 768],
        "note": "可以只考虑 2 个断点"
      },
      "conservative": {
        "scenario": "保守型设计",
        "contentWidth": 1200,
        "compatibleWith": [1920, 1440, 1366, 1280],
        "note": "1200px 内容区可以兼容 4 个断点"
      }
    },
    "channelRecommendation": {
      "largeScreen": {
        "viewport": "> 1280",
        "focus": "大屏点为主",
        "contentWidth": [1440, 1326]
      },
      "smallScreen": {
        "viewport": "< 1200",
        "focus": "小屏点为主",
        "contentWidth": [1240, 984, 728]
      }
    }
  }
}
```

---

## 📊 统计数据

```json
{
  "statistics": {
    "breakpoints": {
      "total": 7,
      "PC": 6,
      "Pad": 2,
      "Mobile": 1
    },
    "contentWidths": {
      "standard": [1440, 1326, 1240, 984, 728],
      "special": [1840, 1200]
    },
    "layoutModes": 4,
    "moduleExamples": {
      "documented": 3,
      "types": ["左右结构", "产品卡片", "Banner"]
    },
    "topResolution": {
      "desktop": "1920x1080 (45.92%)",
      "all": "1920x1080 (35.72%)"
    },
    "designTokensAlignment": {
      "aligned": true,
      "source": "飞鹊组件 AI 友好型规范 (2026.1)",
      "fontSize": {
        "total": 8,
        "values": [12, 14, 16, 18, 22, 24, 32, 36],
        "note": "caption/body/title16/title18/title22/title24/title32/title36"
      },
      "spacing": {
        "base": 4,
        "total": 7,
        "values": [4, 8, 12, 16, 24, 32, 48],
        "note": "xxs/xs/s/m/l/xl/2xl"
      },
      "fontWeight": {
        "total": 2,
        "values": [400, 700],
        "note": "regular/bold"
      },
      "borderRadius": {
        "total": 7,
        "values": ["2px", "4px", "8px", "12px", "16px", "24px", "full"],
        "note": "xxs/xs/s/m/l/xl/full"
      }
    }
  }
}
```

---

## 🔧 AI 使用指南

### 查询断点规范

```
查询格式：
- "1920 断点的内容区宽度是多少"
- "1024 断点的字号用飞鹊哪个标准"
- "显示所有 PC 端断点"
- "移动端用什么断点"
- "1366 断点的间距令牌是什么"
```

### 查询设计令牌

```
查询格式：
- "飞鹊的间距系统有哪些"
- "1920 断点用哪个 title 字号"
- "显示飞鹊标准字号列表"
- "间距 m 是多少像素"
```

### 查询模块适配

```
查询格式：
- "产品卡片在 1366 断点显示几列"
- "左右结构在 768 断点怎么布局"
- "Banner 模块的适配规则"
```

### 生成响应式代码

```
生成请求：
- "生成 1920 断点的 CSS media query"
- "生成产品卡片的响应式网格代码"
- "生成左右结构的响应式布局代码"
- "用飞鹊间距令牌生成 1280 断点的 padding"
```

### 设计令牌快速对照

```json
{
  "fontSize": {
    "caption": "12px",
    "body": "14px (全断点通用)",
    "title16": "16px",
    "title18": "18px (≥768 小屏)",
    "title22": "22px (≥1280 中屏)",
    "title24": "24px (≥1280 中屏)",
    "title32": "32px (≥1366 大屏)",
    "title36": "36px (≥1920 超大屏)"
  },
  "spacing": {
    "xxs": "4px",
    "xs": "8px",
    "s": "12px",
    "m": "16px",
    "l": "24px",
    "xl": "32px",
    "2xl": "48px"
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
      "title": "对齐飞鹊组件设计令牌",
      "changes": [
        "字号系统：从连续范围改为飞鹊标准字号阶梯 (12/14/16/18/22/24/32/36)",
        "间距系统：从任意值改为 4px 倍数，使用飞鹊间距令牌 (xxs/xs/s/m/l/xl/2xl)",
        "字重：统一使用 400(Regular) 和 700(Bold) 两种",
        "圆角：统一使用飞鹊圆角系统 (2px/4px/8px/12px/16px/24px/full)",
        "更新所有断点的字号、间距、内边距数值",
        "添加设计令牌快速对照表"
      ],
      "alignedWith": "飞鹊组件 AI 友好型规范 (2026.1)"
    },
    {
      "version": "1.0",
      "date": "2026-03-20",
      "title": "初始版本",
      "changes": [
        "整理 MIC 主站大小屏适配断点规则",
        "整理元素变化对照表",
        "整理模块适配示例"
      ],
      "source": "MasterGo (173710778459969)"
    }
  ]
}
```

---

_文档生成时间：2026-03-20_  
_最后同步：MasterGo v1.0_  
_文档格式：AI 友好型 (JSON + Markdown 混合)_
