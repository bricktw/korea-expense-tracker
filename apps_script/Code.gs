/**
 * 韓國旅遊家庭記帳 — Google Apps Script Web App 後端
 *
 * 功能：把 React App 的記帳寫進 Google Sheet「明細」分頁，並提供讀取 / 刪除。
 * 設計：單一資料分頁，靠「行程」欄區分不同趟旅行。
 *
 * ── 部署步驟（只需做一次）────────────────────────────────
 * 1. 開啟試算表「韓國旅遊家庭記帳表」→ 上方選單「擴充功能」→「Apps Script」
 * 2. 把本檔內容整段貼上，存檔（磁碟圖示）
 * 3. 右上「部署」→「新增部署」→ 類型選「網頁應用程式」
 *      - 說明：隨意
 *      - 執行身分：我（你的 Google 帳號）
 *      - 誰可以存取：知道連結的任何人
 *    → 「部署」→ 第一次會要求授權，按照指示允許
 * 4. 複製「網頁應用程式 URL」（https://script.google.com/macros/s/XXXX/exec）
 * 5. 貼進 korea-expense-tracker.jsx 最上方的 WEB_APP_URL
 *
 * ※ 之後若改了這支程式，要重新「部署 → 管理部署 → 編輯（鉛筆）→ 版本：新版本 → 部署」
 *   URL 不會變。
 */

// 共用 token：必須與 src/App.jsx 的 API_TOKEN 完全一致。改 token 時兩邊一起改、Code.gs 要重新部署。
var SHARED_TOKEN = '160bd56875889bec1267aa2a6e111a7577bbe9e29996d0fb';

var SHEET_NAME = '明細';
var HEADERS = ['id', '行程', '日期', '時間', '記錄人', '金額(韓圜)', '匯率', '台幣', '付款方式', '類別', '備註'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  var idx = {};
  for (var c = 0; c < head.length; c++) idx[head[c]] = c;
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[idx['id']]) continue;
    rows.push({
      id: String(r[idx['id']]),
      trip: r[idx['行程']],
      date: r[idx['日期']],
      time: r[idx['時間']],
      recorder: r[idx['記錄人']],
      amount: Number(r[idx['金額(韓圜)']]) || 0,
      rate: Number(r[idx['匯率']]) || 0,
      twd: Number(r[idx['台幣']]) || 0,
      method: r[idx['付款方式']],
      category: r[idx['類別']],
      note: r[idx['備註']]
    });
  }
  return rows;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    if (!e || !e.parameter || e.parameter.token !== SHARED_TOKEN) {
      return jsonOut_({ ok: false, error: 'unauthorized' });
    }
    return jsonOut_({ ok: true, data: readAll_() });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) {
      return jsonOut_({ ok: false, error: 'unauthorized' });
    }
    var action = body.action || 'add';
    var sh = getSheet_();

    if (action === 'add') {
      var en = body.entry || body;
      sh.appendRow([
        String(en.id),
        en.trip || '',
        en.date || '',
        en.time || '',
        en.recorder || '',
        Number(en.amount) || 0,
        Number(en.rate) || 0,
        Number(en.twd) || 0,
        en.method || '',
        en.category || '',
        en.note || ''
      ]);
      return jsonOut_({ ok: true });
    }

    if (action === 'delete') {
      var id = String(body.id);
      var values = sh.getDataRange().getValues();
      for (var i = values.length - 1; i >= 1; i--) {
        if (String(values[i][0]) === id) sh.deleteRow(i + 1);
      }
      return jsonOut_({ ok: true });
    }

    if (action === 'list') {
      return jsonOut_({ ok: true, data: readAll_() });
    }

    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
