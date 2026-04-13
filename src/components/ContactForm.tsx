import { CSSProperties, FormEvent, useState } from 'react';
import styles from './ContactForm.module.scss';

// ── Replace this with your Formspree form ID ──────────────────────────────────
// 1. Create a free account at https://formspree.io
// 2. Make a new form (set your email as the destination)
// 3. Copy the ID from the endpoint URL (e.g. "abcdefgh" from /f/abcdefgh)
const FORMSPREE_ID = 'maqawkdv';
// ─────────────────────────────────────────────────────────────────────────────

type State = 'idle' | 'submitting' | 'success' | 'error';

export function ContactForm({ delay = 0 }: { delay?: number }) {
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState('submitting');
    setErrorMsg('');

    const data = new FormData(e.currentTarget);

    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        setState('success');
      } else {
        const json = await res.json().catch(() => ({}));
        setErrorMsg(
          (json as { errors?: { message: string }[] }).errors?.[0]?.message ??
            'something went wrong.',
        );
        setState('error');
      }
    } catch {
      setErrorMsg('something went wrong. try again?');
      setState('error');
    }
  }

  const style = { '--d': `${delay}s` } as CSSProperties;

  if (state === 'success') {
    return (
      <p className={styles.success} style={style}>
        message sent. i'll be in touch.
      </p>
    );
  }

  return (
    <form className={styles.form} style={style} onSubmit={handleSubmit} noValidate>
      <div className={styles.row}>
        <input
          className={styles.input}
          type="text"
          name="name"
          placeholder="your name"
          required
          disabled={state === 'submitting'}
          autoComplete="name"
        />
        <input
          className={styles.input}
          type="email"
          name="email"
          placeholder="your email"
          required
          disabled={state === 'submitting'}
          autoComplete="email"
        />
      </div>
      <textarea
        className={styles.textarea}
        name="message"
        placeholder="your message"
        required
        rows={4}
        disabled={state === 'submitting'}
      />
      {state === 'error' && <p className={styles.errorMsg}>{errorMsg}</p>}
      <button className={styles.button} type="submit" disabled={state === 'submitting'}>
        {state === 'submitting' ? 'sending…' : 'send'}
      </button>
    </form>
  );
}
