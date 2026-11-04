const app=document.querySelector('#app');
let step=-1;
let answers=Array(5).fill(null);
let orders=[];
function shuffle(values){const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function reset(){step=-1;answers=Array(5).fill(null);orders=quizData.questions.map(q=>shuffle(q[1].map((_,i)=>i)));render();}
function focusHeading(){app.querySelector('h1,h2')?.focus();window.scrollTo({top:0,behavior:'instant'});}
function render(){
  if(step<0){app.innerHTML=`<section class="hero"><div><p class="eyebrow">ВАШ ФИНАНСОВЫЙ ХАРАКТЕР</p><h1 tabindex="-1">${quizData.title}</h1><p class="intro">Пять житейских ситуаций — и один знакомый герой. Узнайте, что ваша манера тратить говорит о вас.</p><button class="primary" id="start">Узнать своего персонажа <span aria-hidden="true">↗</span></button><p class="small-note">Около 2 минут · Нет правильных и неправильных ответов</p></div><img class="hero-collage" src="assets/quiz-collage.png" alt="Коллаж: Кот Матроскин, Скрудж Макдак и Остап Бендер" width="1000" height="1200"></section>`;document.querySelector('#start').onclick=()=>{step=0;render();focusHeading();};return;}
  if(step===5){renderResult(calculateResult(answers));return;}
  const q=quizData.questions[step];
  app.innerHTML=`<section class="quiz"><div class="quiz-head"><span>ВОПРОС ${step+1} / 5</span><span>ДЕНЬГИ И ПРИВЫЧКИ</span></div><div class="progress" role="progressbar" aria-label="Пройдено вопросов" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${step}"><span style="width:${step/5*100}%"></span></div><h2 class="question-title" id="question" tabindex="-1">${q[0]}</h2><fieldset class="answers" aria-labelledby="question">${orders[step].map(i=>`<label class="answer ${answers[step]===i?'selected':''}"><input type="radio" name="answer" value="${i}" ${answers[step]===i?'checked':''}><span>${q[1][i][0]}</span></label>`).join('')}</fieldset><div class="nav"><button class="back" id="back">← Назад</button><button class="primary" id="next" ${answers[step]===null?'disabled':''}>${step===4?'Узнать результат':'Следующий вопрос'} <span aria-hidden="true">→</span></button></div></section>`;
  app.querySelectorAll('input').forEach(input=>input.onchange=()=>{answers[step]=Number(input.value);app.querySelectorAll('.answer').forEach(l=>l.classList.toggle('selected',l.contains(input)));document.querySelector('#next').disabled=false;});
  document.querySelector('#back').onclick=()=>{step--;render();focusHeading();};
  document.querySelector('#next').onclick=()=>{if(answers[step]===null)return;step++;render();focusHeading();};
}

function renderResult(id){
  const r=quizData.results[id];
  app.innerHTML=`<section class="result"><p class="eyebrow">${r.tag}</p><div class="result-top"><div><h1 tabindex="-1">Вы — ${r.name}</h1><p class="source">${r.source}</p></div><img class="result-image" src="assets/result-${id}.png" alt="${r.name}"></div><div class="result-copy">${r.paragraphs.map(p=>`<p>${p}</p>`).join('')}</div><div class="result-actions"><button class="primary" id="again">Пройти ещё раз <span aria-hidden="true">↻</span></button></div></section>`;
  document.querySelector('#again').onclick=()=>{reset();focusHeading();};
}
reset();

