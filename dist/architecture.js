const links = Array.from(document.querySelectorAll('.rail a'));
const sections = links
    .map((link) => {
    const href = link.getAttribute('href');
    return href ? document.querySelector(href) : null;
})
    .filter((section) => section !== null);
const observer = new IntersectionObserver((entries) => {
    const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (!visible)
        return;
    links.forEach((link) => {
        if (link.getAttribute('href') === `#${visible.target.id}`)
            link.setAttribute('aria-current', 'true');
        else
            link.removeAttribute('aria-current');
    });
}, { rootMargin: '-18% 0px -70% 0px', threshold: [0, 0.2, 0.6] });
sections.forEach((section) => observer.observe(section));
