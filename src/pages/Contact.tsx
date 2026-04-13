import { WaveText } from '../components/WaveText';
import { ContactForm } from '../components/ContactForm';

const GAP = 1.6;

function Contact() {
  return (
    <section>
      <WaveText as="h1" variant="scatter" text="contact" delay={0} />
      <ContactForm delay={GAP} />
    </section>
  );
}

export default Contact;
