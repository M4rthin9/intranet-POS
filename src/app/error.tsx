'use client';
export default function ErrorScreen({ reset }: { reset: () => void }) {
  return (
    <main className="welcome">
      <h1>ไม่สามารถแสดงหน้าจอได้</h1>
      <p>ตรวจสอบการเชื่อมต่อ หากกำลังส่งรายการให้ตรวจสอบรายการล่าสุดก่อนเริ่มรายการใหม่</p>
      <button className="primary" onClick={reset}>
        ลองแสดงหน้าจออีกครั้ง
      </button>
    </main>
  );
}
