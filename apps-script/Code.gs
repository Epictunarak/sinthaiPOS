/**
 * Code.gs — จุดเข้าของ Web App (doGet/doPost) แยก route ด้วย ?action=
 *
 * ฝั่ง PWA เรียกผ่าน fetch():
 *  - GET  ?action=products&token=...
 *  - GET  ?action=report&date=YYYY-MM-DD&token=...
 *  - POST body (Content-Type: text/plain, เนื้อหาเป็น JSON string):
 *      { action: 'login' | 'createSale' | 'adjustStock', token: '...', payload: {...} }
 *
 * ใช้ text/plain แทน application/json ตอน POST เพื่อให้ browser ส่งเป็น
 * "simple request" ไม่ trigger CORS preflight (OPTIONS) ซึ่ง Apps Script
 * Web App ไม่รองรับการตอบ preflight ได้ดีนัก — ดูรายละเอียดใน web/src/api.js
 */

function doGet(e) {
  try {
    var params = e.parameter;
    checkToken_(params.token);

    switch (params.action) {
      case 'ping':
        return jsonResponse_({ ok: true, time: new Date().toISOString() });
      case 'products':
        return jsonResponse_(handleGetProducts_());
      case 'report':
        return jsonResponse_(handleReport_(params.date));
      case 'settings':
        return jsonResponse_({ ok: true, settings: getSettings_() });
      default:
        return errorResponse_('ไม่รู้จัก action: ' + params.action);
    }
  } catch (err) {
    return errorResponse_(err.message);
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    checkToken_(body.token);
    var payload = body.payload || {};

    switch (body.action) {
      case 'login':
        return jsonResponse_(handleLogin_(payload));
      case 'createSale':
        return jsonResponse_(handleCreateSale_(payload));
      case 'adjustStock':
        return jsonResponse_(handleAdjustStock_(payload));
      case 'setBarcode':
        return jsonResponse_(handleSetBarcode_(payload));
      case 'countStock':
        return jsonResponse_(handleCountStock_(payload));
      case 'voidSale':
        return jsonResponse_(handleVoidSale_(payload));
      default:
        return errorResponse_('ไม่รู้จัก action: ' + body.action);
    }
  } catch (err) {
    return errorResponse_(err.message);
  }
}
