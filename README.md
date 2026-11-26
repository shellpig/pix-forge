# PixForge — 瀏覽器端像素藝術工坊

**繁體中文** ｜ [English](README.en.md)

PixForge 使用 **React、TypeScript、Vite**，將一般圖片轉為可調整尺寸、色盤與輪廓風格的像素藝術，也能逐格修圖、製作動畫並匯出遊戲素材。

圖片轉換、編修與匯出由**使用者的瀏覽器本機執行**，不需要帳號或影像處理後端。網站可能載入 Google Fonts 等外部靜態資源，但不會為了轉換而將使用者的圖片上傳至後端。

## 功能特色

- **降採樣風格：** 精緻角色（主色聚類）、LAB 分離、K-Centroid 銳利及柔和原圖縮放。
- **尺寸與構圖：** 自訂 8–256 像素寬高、常用尺寸預設、非正方形輸出與互動式裁切。
- **影像控制：** 平滑、細緻輪廓、預先銳化、對比、飽和度與透明度閾值。
- **色彩處理：** 自動萃取 2–64 色、經典預設色盤（含純黑白）或保留原色；Bayer 4×4／Floyd–Steinberg 抖色；孤立像素清除（關／輕／強，預設輕）。
- **比較與精修：** 並排、拉桿、僅看像素、格線與縮放；畫筆、橡皮擦、滴管、填色、魔術棒、復原與重做。
- **動畫工作流程：** 一次載入多張圖片，按檔名自然排序，追加、刪除與拖曳影格；可全組共用 Oklab 色盤，並以 1–30 FPS 預覽。
- **輸出：** PNG、Sprite Sheet PNG、循環 GIF、逐格 PNG ZIP；倍率 1×、4×、8×、16×。

支援上傳 PNG、JPEG、WebP、GIF 圖片。**單獨匯入動態 GIF 不會自動拆分影格**；請用多張連續圖片製作動畫。

## 快速開始

需求：**Node.js 22（建議 22.12 或更新）**、npm。專案以 `.node-version` 指定 Node 22。

```bash
git clone https://github.com/shellpig/pix-forge.git
cd pix-forge
npm ci
npm run dev
```

開發網址：`http://localhost:3000`。

| 指令 | 用途 |
| --- | --- |
| `npm test` | 執行回歸測試 |
| `npm run lint` | TypeScript 型別檢查 |
| `npm run build` | 建置至 `dist/` |
| `npm run preview` | 預覽正式建置 |
| `npm run clean` | 清除 `dist/` |

## 操作方式

1. 點選**上傳圖片**建立新工作區；若要保留目前影格，在**動畫時間軸 → 追加影格**加入圖片。也支援 Ctrl+V 貼上。
2. 在右側面板調整尺寸、裁切、演算法、色盤色數與抖色，並使用比較檢視觀察差異。
3. 在右側**文件色盤**選擇原始顏色，直接輸入 HEX 或選擇現有色塊作為目標，套用後替換目前影格所有同色像素；可復原／重做。切到**像素精修**，以畫筆等工具編輯單格，使用復原／重做管理編輯紀錄。
4. 切到**動畫播放**，準備至少兩張影格，在時間軸拖曳排序並調整播放速度。
5. 選擇單張 PNG、Sprite Sheet、GIF 或 ZIP 匯出。新增影格或修改設定可能影響手動編輯時，介面會提供保留手修或套用新轉換的選項。

### 快捷鍵

| 功能 | 操作 |
| --- | --- |
| 貼上圖片 | Ctrl+V（macOS 使用系統貼上快捷鍵） |
| 畫筆／橡皮擦／滴管 | B／E／I |
| 油漆桶／魔術棒 | G／W |
| 復原／重做 | Ctrl+Z／Ctrl+Y（macOS 支援 Command） |
| 吸取色彩 | Alt + 點擊 |
| 播放／暫停 | Space |
| 上一影格／下一影格 | ←／→ |
| 精修指定影格 | 雙擊時間軸縮圖 |

工具列的鍵盤圖示可開啟快捷鍵說明。

## Sprite Sheet 與效能注意事項

Sprite Sheet 預設將影格排列成**接近正方形的網格**（欄數約為 `Math.ceil(Math.sqrt(frameCount))`），也能指定欄數或單排。建立 Canvas 前會檢查**單邊 16,384px**、**總像素 16,000,000** 的保守限制。超限請降低輸出倍率或調整排列；部分瀏覽器可能有更低限制。

「雜點清除」在量化後處理真正孤立的像素：只從周圍 8 格中有足夠票數的顏色挑選 Oklab 色差最近者。「輕」模式至少 4 格支持、色差 ≤0.2；「強」至少 3 格、色差 ≤0.3。兩種模式都保護比所有不透明鄰居亮或暗至少 0.12 的高光與暗點。透明殘點與單點破洞維持更嚴格的 7／6 格門檻。啟用 Bayer／Floyd 抖色時暫停雜點清除，關閉後恢復原選擇。

影格愈多、解析度愈高，記憶體使用量也會增加。批次轉換優先使用瀏覽器 Web Worker；不支援時採用主執行緒備援。

## 技術架構

- `src/App.tsx`：應用狀態、影格與匯出控制。
- `src/components/`：畫布、參數面板、像素精修及時間軸。
- `src/lib/pixelEngine.ts`：降採樣、影像處理與量化。
- `src/lib/palettes.ts`：預設色盤及 Oklab 色彩計算。
- `src/lib/frameHistory.ts`：修圖歷史與復原／重做。
- `src/lib/animationExport.ts`、`spriteSheetLayout.ts`：動畫匯出與尺寸保護。
- `src/workers/pixelConversion.worker.ts`：背景批次轉換。
- `tests/`：回歸測試。

## Cloudflare Workers 部署

這是**純靜態前端網站**。`wrangler.jsonc` 指向 `./dist`，不需要伺服器端 `main`；專案的瀏覽器 Web Worker 與 Cloudflare Workers 是不同技術。

```bash
npm ci
npm run build
npx --no-install wrangler deploy --dry-run
npx --no-install wrangler deploy
```

最後一行需要 Cloudflare 驗證與正確專案權限。Git 整合建議使用 **Build command: `npm run build`**、**Deploy command: `npx wrangler deploy`**；Cloudflare Workers 專案名稱須與設定檔中的 `pix-forge` 一致。

## 致謝與演算法來源

感謝下列開源專案與研究者公開分享技術與知識：

- **[PixelOE — KohakuBlueleaf](https://github.com/KohakuBlueleaf/PixelOE)**：*Detail-Oriented Pixelization based on Contrast-Aware Outline Expansion*。對比感知輪廓擴張與細節保護的研究，為像素化設計提供重要參考。
- **[K-Centroid — Astropulse](https://github.com/Astropulse/K-Centroid-Aseprite)**：使用局部 K-means 分群選出代表色的縮圖概念，啟發了本專案的雙色局部聚類模式。亦可參閱 [Pixel Detector](https://github.com/Astropulse/pixeldetector)。
- **[Oklab — Björn Ottosson](https://bottosson.github.io/posts/oklab/)**：*A perceptual color space for image processing*（2020）。本專案使用 Oklab 概念進行感知色差比較與色盤量化。

**實作聲明：** PixForge 採用自己的 TypeScript／Canvas 處理流程。「LAB 分離」與「K-Centroid 銳利」**不是**上述專案的官方移植或背書；致謝是為了明確標示研究及概念來源。

## 授權

PixForge 原始碼依 [GNU Affero General Public License v3.0](LICENSE) 授權（`AGPL-3.0-only`）。

以下內建範例圖片由專案維護者自行生成。圖片的使用及散布依各自適用的權利與條款，AGPL 授權範圍限於 PixForge 原始碼。

- 貓咪騎士（預設輸出 64×64）`src/assets/images/sample-cat-knight.png`
- 森林小屋（預設輸出 128×96）`src/assets/images/sample-forest-cottage.png`

問題與建議可透過 GitHub Issues 提出。
