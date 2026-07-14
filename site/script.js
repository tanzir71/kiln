const fallbackRepository = 'https://github.com/tanzir71/glaze-alt';

function repositoryUrl() {
  const { hostname, pathname } = window.location;

  if (hostname.endsWith('.github.io')) {
    const owner = hostname.split('.')[0];
    const [repository] = pathname.split('/').filter(Boolean);

    if (owner && repository) {
      return `https://github.com/${owner}/${repository}`;
    }
  }

  return fallbackRepository;
}

const repository = repositoryUrl();

document.querySelectorAll('[data-repo-link]').forEach((link) => {
  const destination = link.dataset.repoLink;
  link.href = destination === 'release' ? `${repository}/releases/latest` : repository;
});

document.querySelector('[data-year]').textContent = String(new Date().getFullYear());

const header = document.querySelector('[data-header]');
const syncHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 16);
syncHeader();
window.addEventListener('scroll', syncHeader, { passive: true });

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealTargets = document.querySelectorAll('.reveal');

if (reducedMotion || !('IntersectionObserver' in window)) {
  revealTargets.forEach((target) => target.classList.add('is-visible'));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.13 },
  );

  revealTargets.forEach((target) => revealObserver.observe(target));
}

const promptTarget = document.querySelector('[data-prompt-text]');
const prompts = [
  'Now add a long-break setting…',
  'Make the alert a little softer…',
  'Add a global start shortcut…',
];

if (promptTarget && !reducedMotion) {
  let promptIndex = 0;
  window.setInterval(() => {
    promptIndex = (promptIndex + 1) % prompts.length;
    promptTarget.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-4px)', offset: 0.45 },
        { opacity: 0, transform: 'translateY(4px)', offset: 0.55 },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 360, easing: 'ease-out' },
    );
    window.setTimeout(() => {
      promptTarget.textContent = prompts[promptIndex];
    }, 180);
  }, 3400);
}
