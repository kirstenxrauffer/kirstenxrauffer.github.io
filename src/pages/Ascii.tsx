import { AsciiCanvas } from '../features/ascii';

export default function Ascii() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      <AsciiCanvas />
    </div>
  );
}
