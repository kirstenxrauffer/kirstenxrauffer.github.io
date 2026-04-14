import { Helmet } from 'react-helmet-async';
import { WaveText } from '../components/WaveText';
import { ContactForm } from '../components/ContactForm';

const GAP = 1.6;

function Contact() {
  return (
    <section>
      <Helmet>
        <title>Contact — Kirsten Rauffer</title>
        <meta
          name="description"
          content="Say hello to Kirsten Rauffer. Full-stack engineer open to collaboration and new projects."
        />
        <link rel="canonical" href="https://kirstenrauffer.com/contact" />
        <meta property="og:url" content="https://kirstenrauffer.com/contact" />
        <meta property="og:title" content="Contact — Kirsten Rauffer" />
        <meta
          property="og:description"
          content="Say hello. Full-stack engineer open to collaboration and new projects."
        />
      </Helmet>
      <WaveText as="h1" variant="scatter" text="contact" delay={0} />
      <ContactForm delay={GAP} />
    </section>
  );
}

export default Contact;
