// Initial data used the very first time the server runs (when data.json does
// not exist yet). After that, the live state lives in backend/data.json.
export const SEED = {
  orders: [],
  // Baked-in copy of the published Google Sheet menu (see backend/menu-sheet.js).
  // Used as the offline fallback; the server re-syncs from the live sheet on
  // startup and whenever POST /api/menu/refresh is called.
  menu: [
    { id: "d1", name: "ทอดน้ำปลาราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🐟", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d2", name: "ผัดน้ำมันหอยราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🐚", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d3", name: "ผัดกระเทียมพริกไทยราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍳", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d4", name: "คั่วพริกเกลือราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍚", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d5", name: "ผัดผงกะหรี่ราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍳", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d6", name: "ผัดน้ำพริกเผาราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍳", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d7", name: "ข้าวผัด", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍚", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d8", name: "ผัดพริกราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍳", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d9", name: "ผัดผักคะน้าราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍳", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 60 }, { name: "ทะเล", price: 70 }, { name: "ปลาเค็ม", price: 70 }], available: true },
    { id: "d10", name: "ผัดกะเพราราดข้าว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🌿", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 70 }], available: true },
    { id: "d11", name: "ข้าวผัดกะเพราไข่เยี่ยวม้า", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍳", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "หมูกรอบ", price: 70 }], available: true },
    { id: "d12", name: "ข้าวผัดกะเพราวุ้นเส้น หมูสับ", price: 60, category: "อาหารจานเดียว", theme: 'day', emoji: "🐷", desc: '', options: [], available: true },
    { id: "d13", name: "ผัดพริกเนื้อราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🥩", desc: '', options: [], available: true },
    { id: "d14", name: "ผัดกะเพราเนื้อราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🥩", desc: '', options: [], available: true },
    { id: "d15", name: "ผัดพริกเผาเนื้อราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🥩", desc: '', options: [], available: true },
    { id: "d16", name: "ผัดเผ็ดเนื้อราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🥩", desc: '', options: [], available: true },
    { id: "d17", name: "คั่วพริกเกลือเนื้อราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🥩", desc: '', options: [], available: true },
    { id: "d18", name: "พริกแกงปลาดุกทอดราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🐟", desc: '', options: [], available: true },
    { id: "d19", name: "พริกแกงปลาดุกราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🐟", desc: '', options: [], available: true },
    { id: "d20", name: "กะเพราปลาดุกราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🐟", desc: '', options: [], available: true },
    { id: "d21", name: "ต้มโคล้งปลาดุกทอดราดข้าว", price: 70, category: "อาหารจานเดียว", theme: 'day', emoji: "🐟", desc: '', options: [], available: true },
    { id: "d22", name: "ผัดเผ็ดกบราดข้าว", price: 80, category: "อาหารจานเดียว", theme: 'day', emoji: "🐸", desc: '', options: [], available: true },
    { id: "d23", name: "ผัดเผ็ดหมูป่าราดข้าว", price: 80, category: "อาหารจานเดียว", theme: 'day', emoji: "🐗", desc: '', options: [], available: true },
    { id: "d24", name: "ผัดซีอิ๊ว", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍜", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d25", name: "ราดหน้า", price: 50, category: "อาหารจานเดียว", theme: 'day', emoji: "🍜", desc: '', options: [{ name: "หมู", price: 50 }, { name: "ไก่", price: 50 }, { name: "ทะเล", price: 70 }], available: true },
    { id: "d26", name: "ต้มข่าไก่", price: 70, category: "กับข้าว", theme: 'day', emoji: "🍗", desc: '', options: [], available: true },
    { id: "d27", name: "ต้มจืดเต้าหู้", price: 70, category: "กับข้าว", theme: 'day', emoji: "🍲", desc: '', options: [{ name: "หมูสับ", price: 70 }, { name: "ไก่สับ", price: 70 }], available: true },
    { id: "d28", name: "ผัดสะตอกุ้ง", price: 80, category: "กับข้าว", theme: 'day', emoji: "🍤", desc: '', options: [], available: true },
    { id: "d29", name: "ผัดเผ็ดปลาดุก", price: 80, category: "กับข้าว", theme: 'day', emoji: "🐟", desc: '', options: [], available: true },
    { id: "d30", name: "ผัดพริกเผาหอยลาย", price: 80, category: "กับข้าว", theme: 'day', emoji: "🐚", desc: '', options: [], available: true },
    { id: "d31", name: "แกงส้ม", price: 80, category: "กับข้าว", theme: 'day', emoji: "🥘", desc: '', options: [{ name: "ปลา", price: 80 }, { name: "หมู", price: 80 }, { name: "กุ้ง", price: 80 }], available: true },
  ],
  stock: {
    // Day-shift stock (kitchen ingredients / limited daily dishes).
    DST01: { name: 'กุ้งสด (ผัดไทย/ต้มยำ)', count: 30, min: 8, theme: 'day' },
    DST02: { name: 'เนื้อปูก้อน (ข้าวผัดปู)', count: 15, min: 4, theme: 'day' },
    DST03: { name: 'มะม่วงน้ำดอกไม้สุก', count: 12, min: 4, theme: 'day' },
    DST04: { name: 'ไข่ไก่สด', count: 60, min: 15, theme: 'day' },
    // Night-shift stock (bar drinks).
    ST01: { name: 'ค็อกเทล Signature Blue Ocean', count: 24, min: 5, theme: 'night' },
    ST02: { name: 'เบียร์คราฟต์รสพีช', count: 8, min: 10, theme: 'night' },
    ST03: { name: 'วิสกี้พรีเมียม (ช็อต)', count: 45, min: 15, theme: 'night' },
    ST04: { name: 'โซดาเกลือหิมะ', count: 2, min: 12, theme: 'night' }
  },
  staff: [
    { user: 'admin', pass: '1234', name: 'ผู้จัดการร้าน' }
  ],
  settings: {
    name: 'ตู้กับข้าวบ้านยาย',
    tables: 12,
    baseUrl: ''
  }
};
