import { WaveText } from '../components/WaveText';
import styles from './About.module.scss';

const GAP = 1.6; // seconds between each line starting

function About() {
  return (
    <section className={styles.section}>
      <WaveText as="h1" variant="scatter" text="kirsten rauffer" delay={0} />
      <WaveText as="p" variant="drift" text="a jersey girl at heart." delay={GAP} />
      <WaveText as="p" variant="drift" text="devoted to buffalo wings and long afternoon naps." delay={GAP * 2} />
      <WaveText as="p" variant="drift" text="three cats orbit my world." delay={GAP * 3} />
      <WaveText as="p" variant="drift" text="so does izzy, the love o' me life." delay={GAP * 4} />
      <WaveText as="p" variant="drift" text="drawn to accessibility, rapid prototyping, and novelty." delay={GAP * 5} />
      <WaveText as="p" variant="drift" text="i'm happiest when art and code" delay={GAP * 7} />
      <WaveText as="p" variant="drift" text="can't quite tell themselves apart." delay={GAP * 8} />
      <WaveText as="p" variant="drift" text="i've carried projects from first spark to daylight" delay={GAP * 9} />
      <WaveText as="p" variant="drift" text="sole, among friends, and while leading others." delay={GAP * 10} />
      <WaveText as="p" variant="drift" text="say hello if you'd like to make something together," delay={GAP * 11} />
      <WaveText as="p" variant="drift" text="or if you just want someone to say hi to." delay={GAP * 12} />
    </section>
  );
}

export default About;
