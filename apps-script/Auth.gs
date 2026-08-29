/**
 * Auth.gs — ล็อกอินพนักงานด้วย PIN (เหมาะกับหน้าเคาน์เตอร์ที่ต้องล็อกอินเร็ว)
 */

function handleLogin_(payload) {
  var pin = payload.pin;
  if (!pin) return { ok: false, error: 'กรุณาระบุ PIN' };

  var staffSheet = getSheet_(SHEET_NAMES.STAFF);
  var staff = sheetToObjects_(staffSheet);
  var pinHash = hashPin_(pin);

  var match = staff.filter(function (s) {
    return s.PinHash === pinHash && s.Active === true;
  })[0];

  if (!match) return { ok: false, error: 'PIN ไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน' };

  return {
    ok: true,
    staff: { userId: match.UserId, name: match.Name, role: match.Role }
  };
}
