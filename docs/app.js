// Kadr site: language switch (EN / RU) and download buttons taken from the latest GitHub release.
(function () {
  'use strict';

  var REPO = 'Raymond0385/YT';
  var RELEASES = 'https://github.com/' + REPO + '/releases/latest';

  var T = {
    en: {},
    ru: {
      nav_features: 'Возможности', nav_download: 'Скачать', nav_faq: 'Вопросы',
      hero_title: 'Шортсы из длинных видео, на вашем компьютере',
      hero_lead: 'Kadr делает субтитры с таймингом по словам, находит лучшие моменты, убирает паузы и экспортирует вертикальное видео. Распознавание речи работает локально.',
      hero_cta: 'Скачать для Windows', hero_more: 'Что умеет',
      feat_title: 'Что умеет',
      f1_t: 'Субтитры с таймингом', f1_p: 'Распознавание речи с отметкой времени для каждого слова. Локальные модели Whisper или облако Groq с вашим ключом. Русский, английский и многие другие языки.',
      f2_t: 'Исправляйте ошибки распознавания', f2_p: 'Слова, в которых распознавание не уверено, подсвечиваются. Глоссарий исправляет имена и термины. Вставьте верный текст, и субтитры сохранят тайминг.',
      f3_t: 'Шортсы из длинных видео', f3_p: 'Находит законченные отрывки по 25–60 секунд на английском, русском и урду/хинди латиницей. Границы, названия, добавление и удаление правятся вручную.',
      f4_t: 'Один вид в превью и в экспорте', f4_p: 'Больше 100 стилей субтитров. Шрифты, обводка, тень, подложки и эмодзи над текстом попадают в видео так, как вы их видите.',
      f5_t: 'Настоящий редактор', f5_p: 'Таймлайн, где правится каждое слово, бритва, удаление пауз, B-roll из Pexels (ваш ключ), отмена и повтор.',
      f6_t: 'Проекты и YouTube', f6_p: 'Сохраняйте всю работу в файл .kadr и продолжайте позже. Добавляйте видео по ссылке YouTube, если у вас есть на него права.',
      how_title: 'Как это работает',
      s1_t: 'Откройте видео', s1_p: 'с диска или по ссылке YouTube.',
      s2_t: 'Создайте субтитры', s2_p: 'выберите язык и движок, затем поправьте подсвеченные слова.',
      s3_t: 'Выберите или вырежьте шорт', s3_p: 'возьмите предложенный момент или отметьте свой.',
      s4_t: 'Экспортируйте', s4_p: 'файл попадёт в выбранную вами папку. Если есть видеокарта, используется её кодировщик.',
      dl_title: 'Скачать', dl_note: 'Python, FFmpeg и движок распознавания уже внутри. Ничего ставить отдельно не нужно.',
      dl_all: 'Все файлы на GitHub',
      faq_title: 'Вопросы',
      q1: 'Мои видео куда-нибудь загружаются?', a1: 'Нет. Распознавание и рендер идут на вашем компьютере. Исключение одно: необязательный движок Groq получает звук, если вы добавили свой ключ Groq. Сервера аналитики в приложении нет.',
      q2: 'Нужна ли видеокарта?', a2: 'Нет. Видеокарта ускоряет распознавание и экспорт, но всё работает и на процессоре. Крупные офлайн-модели скачиваются один раз при первом использовании (около 1.5 ГБ для Turbo).',
      q3: 'Можно ли скачивать с YouTube?', a3: 'Вкладка импорта загружает видео по ссылке в редактор. Используйте её только для своих видео или тех, что вам разрешено использовать; правила YouTube действуют.',
      q4: 'Как работают обновления?', a4: 'Приложение смотрит релизы этого репозитория (Настройки → Updates) и скачивает новый установщик, если он есть.',
      q5: 'Какая лицензия?', a5: 'Код под лицензией MIT. Kadr вырос из открытого проекта CapShorts Ali Raza; исходное уведомление об авторстве сохранено в репозитории.',
      foot_changes: 'История изменений', foot_issues: 'Сообщить о проблеме'
    }
  };

  var html = document.documentElement;
  var btn = document.getElementById('langBtn');
  var state = { lang: 'en', release: null };

  // keep the English text from the page so switching back needs no second copy
  var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-i18n]'));
  nodes.forEach(function (el) { T.en[el.getAttribute('data-i18n')] = el.textContent; });

  function setLang(lang) {
    state.lang = lang;
    html.lang = lang;
    nodes.forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var text = (T[lang] && T[lang][key]) || T.en[key];
      if (text != null && !el.hasAttribute('data-keep')) el.textContent = text;
    });
    btn.textContent = lang === 'ru' ? 'EN' : 'RU';
    try { localStorage.setItem('kadr_lang', lang); } catch (e) { /* storage unavailable */ }
    renderRelease();
  }

  function mb(bytes) { return (bytes / 1048576).toFixed(0) + ' MB'; }

  function pick(assets, test) {
    for (var i = 0; i < assets.length; i++) if (test(assets[i].name)) return assets[i];
    return null;
  }

  function renderRelease() {
    var rel = state.release;
    var box = document.getElementById('downloads');
    var ver = document.getElementById('dlVersion');
    var heroVer = document.getElementById('heroVersion');
    var hero = document.getElementById('heroDownload');
    if (!rel) return;

    var assets = rel.assets || [];
    var exe = pick(assets, function (n) { return /-setup\.exe$/i.test(n); });
    var msi = pick(assets, function (n) { return /\.msi$/i.test(n); });
    var dmg = pick(assets, function (n) { return /\.dmg$/i.test(n); });

    var items = [
      [exe, state.lang === 'ru' ? 'Windows (установщик)' : 'Windows installer', true],
      [msi, state.lang === 'ru' ? 'Windows (MSI)' : 'Windows MSI', false],
      [dmg, state.lang === 'ru' ? 'macOS' : 'macOS', false]
    ].filter(function (x) { return x[0]; });

    if (items.length) {
      box.textContent = '';
      items.forEach(function (x) {
        var a = document.createElement('a');
        a.className = 'btn' + (x[2] ? ' primary' : '');
        a.href = x[0].browser_download_url;
        a.rel = 'noopener';
        a.textContent = x[1];
        var s = document.createElement('small');
        s.textContent = mb(x[0].size);
        a.appendChild(s);
        box.appendChild(a);
      });
    }
    if (exe) hero.href = exe.browser_download_url;

    var date = rel.published_at ? new Date(rel.published_at).toLocaleDateString(state.lang === 'ru' ? 'ru-RU' : 'en-GB') : '';
    var label = (state.lang === 'ru' ? 'Версия ' : 'Version ') + String(rel.tag_name || '').replace(/^v/, '') + (date ? ' · ' + date : '');
    ver.textContent = label;
    heroVer.textContent = label;
  }

  function loadRelease() {
    if (!window.fetch) return;
    fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) { if (rel && rel.tag_name) { state.release = rel; renderRelease(); } })
      .catch(function () { /* offline or rate limited: the static link to the releases page stays */ });
  }

  btn.addEventListener('click', function () { setLang(state.lang === 'ru' ? 'en' : 'ru'); });

  var saved = null;
  try { saved = localStorage.getItem('kadr_lang'); } catch (e) { /* storage unavailable */ }
  var wanted = saved || ((navigator.language || '').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en');
  setLang(wanted === 'ru' ? 'ru' : 'en');
  loadRelease();
  void RELEASES;
})();
