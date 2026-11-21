const app=document.querySelector('#app');
const questionCount=quizData.questions.length;
let step=-1;
let answers=Array(questionCount).fill(null);
let orders=[];
let submissionId=null;
function shuffle(values){const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function reset(){step=-1;submissionId=null;answers=Array(questionCount).fill(null);orders=quizData.questions.map(q=>shuffle(q[1].map((_,i)=>i)));render();}
function focusHeading(){app.querySelector('h1,h2')?.focus();window.scrollTo({top:0,behavior:'instant'});}
function render(){
  document.body.classList.toggle('is-quiz',step>=0&&step<questionCount);
  if(step<0){app.innerHTML=`<section class="hero"><div><p class="eyebrow">ВАШ ФИНАНСОВЫЙ ХАРАКТЕР</p><h1 tabindex="-1">${quizData.title}</h1><p class="intro">${questionCount} житейских ситуаций — и один знакомый герой. Узнайте, что ваша манера тратить говорит о вас.</p><button class="primary" id="start">Узнать своего персонажа</button><p class="small-note">Около 2 минут · Нет правильных и неправильных ответов</p></div><img class="hero-collage" src="assets/quiz-collage.png" alt="Коллаж: Кот Матроскин, Скрудж Макдак и Остап Бендер" width="1000" height="1200"></section>`;document.querySelector('#start').onclick=()=>{step=0;render();focusHeading();};return;}
  if(step===questionCount){renderEmailForm();return;}
  const q=quizData.questions[step];
  app.innerHTML=`<section class="quiz"><div class="quiz-head"><span>ВОПРОС ${step+1} / ${questionCount}</span></div><div class="progress" role="progressbar" aria-label="Пройдено вопросов" aria-valuemin="0" aria-valuemax="${questionCount}" aria-valuenow="${step}"><span style="width:${step/questionCount*100}%"></span></div><h2 class="question-title" id="question" tabindex="-1">${q[0]}</h2><p class="answer-hint" id="answer-hint">Выберите ответ — ${step===questionCount-1?'предложим получить результат на почту':'сразу перейдём дальше'}</p><div class="answers" role="group" aria-labelledby="question" aria-describedby="answer-hint">${orders[step].map(i=>`<button type="button" class="answer ${answers[step]===i?'selected':''}" data-answer="${i}" aria-pressed="${answers[step]===i}"><span class="answer-mark" aria-hidden="true"></span><span>${q[1][i][0]}</span></button>`).join('')}</div><div class="nav"><button class="back" id="back">Назад</button></div></section>`;
  app.querySelectorAll('[data-answer]').forEach(button=>button.onclick=()=>{answers[step]=Number(button.dataset.answer);step++;render();focusHeading();});
  document.querySelector('#back').onclick=()=>{step--;render();focusHeading();};
}

async function shareQuiz(){
  const url=new URL('./',window.location.href).href;
  const status=app.querySelector('#share-status');
  const button=app.querySelector('#share');
  button.disabled=true;
  status.textContent='';
  app.querySelector('#share-link').hidden=true;
  try{
    if(navigator.share){
      try{
        await navigator.share({title:quizData.title,text:'Узнай своего финансового персонажа',url});
        return;
      }catch(error){if(error.name==='AbortError')return;}
    }
    try{
      await navigator.clipboard.writeText(url);
      status.textContent='Ссылка скопирована — отправьте её друзьям';
    }catch{
      const field=app.querySelector('#share-link');
      if(!field)return;
      field.value=url;
      field.hidden=false;
      field.focus();
      field.select();
      status.textContent='Скопируйте ссылку и отправьте её друзьям';
    }
  }finally{button.disabled=false;}
}

function renderEmailForm(){
  app.innerHTML=`<section class="email-card"><p class="eyebrow">ВСЕ ${questionCount} ВОПРОСОВ ПОЗАДИ</p><h1 tabindex="-1">Ваш результат готов</h1><p class="intro">Отправим вашего финансового персонажа и его описание на почту</p><form id="email-form"><label class="email-label" for="email">Ваша почта</label><input id="email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="name@example.com" required><label class="consent"><input type="checkbox" name="dataConsent" required><span>Согласен на сохранение моей почты и результата квиза для отправки результата</span></label><p class="form-status" id="form-status" role="status" aria-live="polite"></p><button class="primary" type="submit">Получить результат</button></form><div class="nav"><button class="back" id="back">Назад к вопросам</button><button class="secondary" type="button" id="share">Поделиться</button></div><p class="share-status" id="share-status" role="status" aria-live="polite"></p><input class="share-link" id="share-link" type="text" readonly aria-label="Ссылка на квиз" hidden></section>`;
  const form=app.querySelector('#email-form');
  const status=app.querySelector('#form-status');
  app.querySelector('#share').onclick=shareQuiz;
  form.addEventListener('input',()=>{submissionId=null;status.textContent='';});
  app.querySelector('#back').onclick=()=>{submissionId=null;step=questionCount-1;render();focusHeading();};
  form.onsubmit=async event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    const email=form.elements.email.value.trim();
    const marketingConsent=false;
    submissionId??=crypto.randomUUID();
    const controls=[...form.elements,app.querySelector('#back')];
    controls.forEach(control=>control.disabled=true);
    status.textContent='Отправляем письмо…';
    try{
      const response=await fetch('/api/submit-quiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,answers,submissionId,dataConsent:true,marketingConsent}),signal:AbortSignal.timeout(25000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Не удалось отправить письмо. Попробуйте ещё раз.');
      app.innerHTML=`<section class="email-card"><p class="eyebrow">ГОТОВО</p><h1 tabindex="-1">Письмо отправлено</h1><p class="intro">Ищите результат на <strong id="sent-email"></strong>. Если письма нет во входящих, проверьте папку «Спам».</p><button class="primary" id="again">Пройти ещё раз</button></section>`;
      app.querySelector('#sent-email').textContent=email;
      app.querySelector('#again').onclick=()=>{reset();focusHeading();};
      focusHeading();
    }catch(error){
      status.textContent=error.name==='TimeoutError'?'Ответ задерживается. Попробуйте ещё раз — ваши ответы сохранены на этой странице.':error.message==='Failed to fetch'?'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.':error.message;
      controls.forEach(control=>control.disabled=false);
    }
  };
}
reset();
