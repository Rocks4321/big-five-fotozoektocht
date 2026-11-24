
import './style.css'
import { createClient } from '@supabase/supabase-js'

// ===================================
// SUPABASE
// ===================================

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const app = document.querySelector('#app')

const SECONDS_PER_QUESTION = 10
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

let currentTeam = null
let currentSession = null
let currentUser = null

let photoTasks = []
let photoProgress = []

let selectedFile = null
let previewUrl = null

let questions = []
let quizAnswers = {}
let startedAt = null
let currentQuestionIndex = 0
let selectedAnswer = null
let questionDeadline = 0
let timerId = null
let advancing = false
let submitting = false

// ===================================
// HULPFUNCTIES
// ===================================

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeTeamName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function logoHtml() {
  return `
    <div class="quiz-logo">
      <img
        src="${import.meta.env.BASE_URL}logo-rnr.png"
        alt="Rocks 'n Rivers logo"
      />
    </div>
  `
}

function page(content) {
  app.innerHTML = `
    ${logoHtml()}
    <main class="quiz-page">
      ${content}
    </main>
  `
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
}

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
  }

  previewUrl = null
  selectedFile = null
}

function showError(message) {
  stopTimer()
  clearPreview()

  page(`
    <section class="quiz-card">
      <h1>Er ging iets mis</h1>
      <p>${escapeHtml(message)}</p>

      <button id="reload" type="button">
        Opnieuw proberen
      </button>
    </section>
  `)

  document
    .querySelector('#reload')
    .addEventListener('click', () => {
      location.reload()
    })
}

function pendingKey(taskId) {
  return `bigfive-pending:${currentTeam.id}:${taskId}`
}

function getPhotoPath(taskId) {
  return (
    `${currentUser.id}/` +
    `${currentTeam.id}/` +
    `${taskId}.jpg`
  )
}

// ===================================
// APP INITIALISEREN
// ===================================

async function initializeApp() {
  page(`
    <section class="quiz-card">
      <p>Big Five Fotozoektocht laden...</p>
    </section>
  `)

  const {
    data: sessionData,
    error: sessionError
  } = await supabase.auth.getSession()

  if (sessionError) {
    showError('Aanmelden is mislukt.')
    return
  }

  if (
    sessionData.session &&
    !sessionData.session.user.is_anonymous
  ) {
    showError(
      'Op dit apparaat is een instructeur ingelogd. ' +
      'Gebruik voor de teamomgeving een privévenster.'
    )
    return
  }

  if (!sessionData.session) {
    const { error } =
      await supabase.auth.signInAnonymously()

    if (error) {
      console.error(error)

      showError(
        'Anoniem aanmelden is mislukt.'
      )
      return
    }
  }

  const {
    data: userData,
    error: userError
  } = await supabase.auth.getUser()

  if (userError || !userData.user) {
    showError(
      'Gebruikersgegevens ophalen is mislukt.'
    )
    return
  }

  currentUser = userData.user

  // Actief programma ophalen

  const {
    data: sessions,
    error: sessionQueryError
  } = await supabase
    .from('game_sessions')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', {
      ascending: false
    })
    .limit(1)

  if (sessionQueryError || !sessions?.length) {
    showError(
      'Er is geen actief programma gevonden.'
    )
    return
  }

  currentSession = sessions[0]

  // Bestaand team op dit apparaat zoeken

  const {
    data: teams,
    error: teamError
  } = await supabase
    .from('game_teams')
    .select('id, team_name, session_id')
    .eq('session_id', currentSession.id)
    .eq('owner_user_id', currentUser.id)
    .limit(1)

  if (teamError) {
    console.error(teamError)
    showError('Teamgegevens ophalen is mislukt.')
    return
  }

  if (teams?.length) {
    currentTeam = teams[0]
    await showHome()
  } else {
    showStartScreen()
  }
}

// ===================================
// STARTPAGINA
// ===================================

function showStartScreen() {
  page(`
    <section class="quiz-card start-card">
      <h1>Big Five Fotozoektocht</h1>

      <p>
        Vul jullie teamnaam in
        en start het avontuur!
      </p>

      <form id="teamForm">
        <label for="teamName">
          <strong>Teamnaam</strong>
        </label>

        <input
          id="teamName"
          type="text"
          maxlength="60"
          placeholder="Bijvoorbeeld: Team Leeuw"
          required
          autocomplete="off"
        />

        <button id="startButton" type="submit">
          Start Big Five Fotozoektocht
        </button>
      </form>

      <p
        id="startError"
        class="error-message"
      ></p>
    </section>
  `)

  document
    .querySelector('#teamForm')
    .addEventListener('submit', registerTeam)
}

// ===================================
// TEAM REGISTREREN
// ===================================

async function registerTeam(event) {
  event.preventDefault()

  const input =
    document.querySelector('#teamName')

  const button =
    document.querySelector('#startButton')

  const errorEl =
    document.querySelector('#startError')

  const name = normalizeTeamName(input.value)

  if (!name) return

  button.disabled = true
  button.textContent = 'Team registreren...'
  errorEl.textContent = ''

  const { data, error } = await supabase
    .from('game_teams')
    .insert({
      session_id: currentSession.id,
      team_name: name,
      owner_user_id: currentUser.id
    })
    .select('id, team_name, session_id')
    .single()

  if (error) {
    console.error(error)

    errorEl.textContent =
      error.code === '23505'
        ? 'Deze teamnaam is al gebruikt, of dit apparaat heeft al een team.'
        : 'Registreren is mislukt.'

    button.disabled = false
    button.textContent =
      'Start Big Five Fotozoektocht'

    return
  }

  currentTeam = data
  await showHome()
}

// ===================================
// QUIZSTATUS OPHALEN
// ===================================

async function getQuizSubmission() {
  const { data, error } = await supabase
    .from('submissions')
    .select('id, correct_count')
    .eq('team_id', currentTeam.id)
    .limit(1)

  if (error) throw error

  return data?.[0] ?? null
}

// ===================================
// FOTO VOORTGANG OPHALEN
// ===================================

async function loadPhotoProgress() {
  const { data, error } = await supabase
    .from('team_photo_progress')
    .select('task_id, submitted_at')
    .eq('team_id', currentTeam.id)

  if (error) throw error

  photoProgress = data ?? []
}

function isPhotoSubmitted(taskId) {
  return photoProgress.some(
    item => item.task_id === taskId
  )
}

// ===================================
// WELKOMSTPAGINA
// ===================================

async function showHome() {
  stopTimer()
  clearPreview()

  page(`
    <section class="quiz-card">
      <p>Opdrachten laden...</p>
    </section>
  `)

  let quizSubmission

  try {
    const [
      quizResult,
      tasksResult
    ] = await Promise.all([
      getQuizSubmission(),

      supabase
        .from('photo_tasks')
        .select('id, title, description')
        .order('id')
    ])

    quizSubmission = quizResult

    if (tasksResult.error) {
      throw tasksResult.error
    }

    photoTasks = tasksResult.data ?? []

    await loadPhotoProgress()
  } catch (error) {
    console.error(error)

    showError(
      'De opdrachten konden niet worden geladen.'
    )
    return
  }

  const submittedPhotos =
    photoTasks.filter(task =>
      isPhotoSubmitted(task.id)
    ).length

  page(`
    <section class="quiz-card quiz-header-card">

      <h1>
        Welkom ${escapeHtml(currentTeam.team_name)}!
      </h1>

      <p>
        Kies zelf in welke volgorde
        jullie de opdrachten doen.
      </p>

      <p>
        <strong>Foto-opdrachten:</strong>
        ${submittedPhotos} van ${photoTasks.length}
        ingestuurd
      </p>

    </section>

    <section class="quiz-card">

      <h2>🧠 Kennisquiz</h2>

      <p>
        Jullie hebben 10 seconden per vraag.
      </p>

      <button
        id="openQuiz"
        type="button"
        ${quizSubmission ? 'disabled' : ''}
      >
        ${
          quizSubmission
            ? 'Kennisquiz voltooid ✓'
            : 'Start kennisquiz'
        }
      </button>

    </section>

    ${photoTasks.map(task => {
      const done = isPhotoSubmitted(task.id)

      return `
        <section class="quiz-card">

          <h2>
            📸 Foto-opdracht ${task.id}
          </h2>

          <p>
            <strong>
              ${escapeHtml(task.title)}
            </strong>
          </p>

          <p>
            ${escapeHtml(task.description)}
          </p>

          ${
            done
              ? '<p>✅ Foto ingestuurd</p>'
              : '<p>○ Nog niet ingestuurd</p>'
          }

          <button
            class="photoTaskButton"
            type="button"
            data-id="${task.id}"
          >
            ${
              done
                ? 'Bekijk status'
                : 'Open foto-opdracht'
            }
          </button>

        </section>
      `
    }).join('')}
  `)

  const quizButton =
    document.querySelector('#openQuiz')

  if (!quizSubmission) {
    quizButton.addEventListener(
      'click',
      startQuiz
    )
  }

  document
    .querySelectorAll('.photoTaskButton')
    .forEach(button => {
      button.addEventListener('click', () => {
        showPhotoTask(
          Number(button.dataset.id)
        )
      })
    })
}

// ===================================
// FOTO-OPDRACHT OPENEN
// ===================================

async function showPhotoTask(taskId) {
  stopTimer()
  clearPreview()

  const task = photoTasks.find(
    item => item.id === taskId
  )

  if (!task) {
    await showHome()
    return
  }

  try {
    await loadPhotoProgress()
  } catch (error) {
    console.error(error)
    showError('Fotovoortgang ophalen mislukt.')
    return
  }

  if (isPhotoSubmitted(taskId)) {
    page(`
      <section class="quiz-card">

        <h1>Foto-opdracht ${task.id}</h1>

        <h2>${escapeHtml(task.title)}</h2>

        <p>${escapeHtml(task.description)}</p>

        <p>
          ✅ <strong>Foto ingestuurd!</strong>
        </p>

        <p>
          Deze foto is definitief verzonden.
          Je kunt geen nieuwe foto insturen.
        </p>

        <button id="backHome" type="button">
          Terug naar opdrachten
        </button>

      </section>
    `)

    document
      .querySelector('#backHome')
      .addEventListener('click', showHome)

    return
  }

  // Is het fotobestand al geüpload,
  // maar de database-registratie nog niet klaar?

  const pendingPath =
    localStorage.getItem(pendingKey(taskId))

  page(`
    <section class="quiz-card">

      <button id="backHome" type="button">
        ← Terug naar opdrachten
      </button>

      <h1>
        Foto-opdracht ${task.id}
      </h1>

      <h2>
        ${escapeHtml(task.title)}
      </h2>

      <p class="question-text">
        ${escapeHtml(task.description)}
      </p>

      ${
        pendingPath
          ? `
            <p>
              Er staat nog een foto klaar
              waarvan de registratie niet
              is afgerond.
            </p>

            <button
              id="completePending"
              type="button"
            >
              Fotoverzending afronden
            </button>
          `
          : `
            <label for="photoInput">
              <strong>
                Maak of kies een foto
              </strong>
            </label>

            <input
              id="photoInput"
              type="file"
              accept="image/*"
            />

            <div
              id="previewContainer"
              hidden
              style="margin-top:20px;"
            >
              <h3>Controleer jullie foto</h3>

              <img
                id="photoPreview"
                alt="Voorbeeld van jullie foto"
                style="
                  width:100%;
                  max-height:450px;
                  object-fit:contain;
                  border-radius:12px;
                "
              />

              <p>
                Zijn jullie tevreden?
                Na verzending kan de foto
                niet meer worden vervangen.
              </p>

              <button
                id="sendPhoto"
                type="button"
                disabled
              >
                Foto definitief verzenden
              </button>
            </div>
          `
      }

      <p
        id="photoError"
        class="error-message"
        role="alert"
      ></p>

    </section>
  `)

  document
    .querySelector('#backHome')
    .addEventListener('click', showHome)

  if (pendingPath) {
    document
      .querySelector('#completePending')
      .addEventListener('click', () => {
        completePhotoSubmission(
          taskId,
          pendingPath
        )
      })

    return
  }

  // Bestand selecteren

  document
    .querySelector('#photoInput')
    .addEventListener('change', event => {
      clearPreview()

      const file = event.target.files?.[0]

      const errorEl =
        document.querySelector('#photoError')

      const container =
        document.querySelector('#previewContainer')

      const sendButton =
        document.querySelector('#sendPhoto')

      errorEl.textContent = ''
      container.hidden = true
      sendButton.disabled = true

      if (!file) return

      if (!file.type.startsWith('image/')) {
        errorEl.textContent =
          'Kies een geldig afbeeldingsbestand.'
        return
      }

      selectedFile = file
      previewUrl = URL.createObjectURL(file)

      document.querySelector(
        '#photoPreview'
      ).src = previewUrl

      container.hidden = false
      sendButton.disabled = false
    })

  // Definitief verzenden

  document
    .querySelector('#sendPhoto')
    .addEventListener('click', () => {
      uploadPhoto(taskId)
    })
}

// ===================================
// FOTO OMZETTEN NAAR JPG
// ===================================

// De huidige Storage-regels verwachten
// altijd een bestandsnaam zoals 1.jpg.
//
// Ook PNG en WebP worden daarom eerst
// naar een JPEG-afbeelding omgezet.

async function convertPhotoToJpeg(file) {
  const objectUrl = URL.createObjectURL(file)

  try {
    const image = new Image()

    image.src = objectUrl

    await image.decode()

    const maxDimension = 1800

    const scale = Math.min(
      1,
      maxDimension /
        Math.max(
          image.naturalWidth,
          image.naturalHeight
        )
    )

    const width = Math.round(
      image.naturalWidth * scale
    )

    const height = Math.round(
      image.naturalHeight * scale
    )

    if (!width || !height) {
      throw new Error(
        'De afbeelding kon niet worden gelezen.'
      )
    }

    const canvas =
      document.createElement('canvas')

    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error(
        'Afbeelding verwerken mislukt.'
      )
    }

    // Witte achtergrond voor
    // transparante PNG-afbeeldingen.

    context.fillStyle = '#ffffff'
    context.fillRect(
      0,
      0,
      width,
      height
    )

    context.drawImage(
      image,
      0,
      0,
      width,
      height
    )

    const blob = await new Promise(
      (resolve, reject) => {
        canvas.toBlob(
          result => {
            if (result) {
              resolve(result)
            } else {
              reject(
                new Error(
                  'Omzetten naar JPG is mislukt.'
                )
              )
            }
          },
          'image/jpeg',
          0.82
        )
      }
    )

    if (blob.size > MAX_PHOTO_BYTES) {
      throw new Error(
        'De foto is nog te groot. Kies een kleinere foto.'
      )
    }

    return blob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// ===================================
// FOTO UPLOADEN NAAR SUPABASE
// ===================================

async function uploadPhoto(taskId) {
  if (!selectedFile) return

  const sendButton =
    document.querySelector('#sendPhoto')

  const errorEl =
    document.querySelector('#photoError')

  sendButton.disabled = true
  sendButton.textContent = 'Foto verwerken...'
  errorEl.textContent = ''

  try {
    // Nogmaals controleren of de opdracht
    // niet al definitief is ingestuurd.

    await loadPhotoProgress()

    if (isPhotoSubmitted(taskId)) {
      await showPhotoTask(taskId)
      return
    }

    const path = getPhotoPath(taskId)

    const jpegBlob =
      await convertPhotoToJpeg(selectedFile)

    sendButton.textContent =
      'Foto uploaden...'

    const { error: uploadError } =
      await supabase.storage
        .from('big-five-photos')
        .upload(path, jpegBlob, {
          contentType: 'image/jpeg',
          upsert: false,
          cacheControl: '3600'
        })

    if (uploadError) {
      throw uploadError
    }

    // Het bestand staat nu in Storage.
    // Bewaar tijdelijk het pad, zodat
    // registratie kan worden hersteld.

    localStorage.setItem(
      pendingKey(taskId),
      path
    )

    await completePhotoSubmission(
      taskId,
      path
    )
  } catch (error) {
    console.error(
      'Foto upload mislukt:',
      error
    )

    errorEl.textContent =
      'Uploaden is mislukt: ' +
      (error.message || 'Onbekende fout.')

    if (sendButton.isConnected) {
      sendButton.disabled = false
      sendButton.textContent =
        'Opnieuw proberen'
    }
  }
}

// ===================================
// DEFINITIEVE FOTO REGISTREREN
// ===================================

async function completePhotoSubmission(
  taskId,
  path
) {
  const errorEl =
    document.querySelector('#photoError')

  const actionButton =
    document.querySelector(
      '#completePending, #sendPhoto'
    )

  if (actionButton) {
    actionButton.disabled = true
    actionButton.textContent =
      'Foto registreren...'
  }

  try {
    // Eerst controleren op bestaande
    // definitieve inzending.

    await loadPhotoProgress()

    if (isPhotoSubmitted(taskId)) {
      localStorage.removeItem(
        pendingKey(taskId)
      )

      await showPhotoTask(taskId)
      return
    }

    if (path !== getPhotoPath(taskId)) {
      throw new Error(
        'Ongeldig fotopad.'
      )
    }

    const { error } = await supabase
      .from('photo_submissions')
      .insert({
        team_id: currentTeam.id,
        task_id: taskId,
        photo_path: path
      })

    if (error) {
      throw error
    }

    // De database-trigger maakt nu
    // automatisch team_photo_progress aan.

    localStorage.removeItem(
      pendingKey(taskId)
    )

    clearPreview()

    page(`
      <section class="quiz-card">

        <h1>✅ Foto ingestuurd!</h1>

        <p>
          Foto-opdracht ${taskId}
          is definitief verzonden.
        </p>

        <p>
          Jullie kunnen deze foto
          niet meer vervangen.
        </p>

        <button id="backHome" type="button">
          Terug naar opdrachten
        </button>

      </section>
    `)

    document
      .querySelector('#backHome')
      .addEventListener('click', showHome)
  } catch (error) {
    console.error(
      'Foto registreren mislukt:',
      error
    )

    if (errorEl) {
      errorEl.textContent =
        'Het registreren is niet gelukt. ' +
        'Probeer de fotoverzending af te ronden. ' +
        (error.message || '')
    }

    if (actionButton?.isConnected) {
      actionButton.disabled = false
      actionButton.textContent =
        'Fotoverzending afronden'

      // Niet opnieuw uploaden,
      // uitsluitend de registratie herhalen.
      actionButton.onclick = () => {
        completePhotoSubmission(taskId, path)
      }
    }
  }
}

// ===================================
// KENNISQUIZ
// ===================================

function getOptions(question) {
  return [
    { letter: 'A', text: question.option_a },
    { letter: 'B', text: question.option_b },
    { letter: 'C', text: question.option_c },
    { letter: 'D', text: question.option_d }
  ].filter(option => option.text)
}


async function startQuiz() {
  try {
    const existing = await getQuizSubmission()

    if (existing) {
      await showHome()
      return
    }

    page(`
      <section class="quiz-card">
        <p>Kennisquiz laden...</p>
      </section>
    `)

    // Starttijd veilig registreren bij Supabase.
    const { data: startTime, error: startError } =
      await supabase.rpc('start_big_five_quiz', {
        p_team_id: currentTeam.id
      })

    if (startError) throw startError

    // Vragen ophalen zonder juiste antwoorden.
    const { data, error } = await supabase.rpc(
      'get_big_five_quiz_questions'
    )

    if (error) throw error

    if (!data?.length) {
      throw new Error('Geen quizvragen gevonden.')
    }

    questions = data

    quizAnswers = {}
    currentQuestionIndex = 0

    startedAt = new Date(startTime)

    showQuestion()

  } catch (error) {
    console.error('Quiz starten mislukt:', error)

    showError(
      error.message ||
      'De kennisquiz kon niet worden gestart.'
    )
  }
}

// ===================================
// KENNISQUIZVRAAG TONEN
// ===================================

function showQuestion() {
  stopTimer()

  advancing = false
  selectedAnswer = null

  const question =
    questions[currentQuestionIndex]

  if (!question) return

  const isLast =
    currentQuestionIndex === questions.length - 1

  const optionsHtml = getOptions(question)
    .map(option => `
      <label class="answer-option">

        <input
          type="radio"
          name="currentAnswer"
          value="${option.letter}"
        />

        <span class="answer-letter">
          ${option.letter}
        </span>

        <span class="answer-text">
          ${escapeHtml(option.text)}
        </span>

      </label>
    `)
    .join('')

  page(`
    <section class="quiz-card quiz-header-card">

      <h1>Big Five Fotozoektocht</h1>

      <p>
        <strong>Team:</strong>
        ${escapeHtml(currentTeam.team_name)}
      </p>

      <p>
        Vraag ${currentQuestionIndex + 1}
        van ${questions.length}
      </p>

      <div class="question-timer">
        ⏱️ Nog
        <strong id="secondsLeft">
          ${SECONDS_PER_QUESTION}
        </strong>
        seconden
      </div>

      <div
        style="
          height:8px;
          background:#ddd;
          border-radius:8px;
          overflow:hidden;
        "
      >
        <div
          id="timerBar"
          style="
            width:100%;
            height:100%;
            background:#198754;
          "
        ></div>
      </div>

    </section>

    <section class="quiz-card question-card">

      <h2>
        Vraag ${escapeHtml(
          question.question_number
        )}
      </h2>

      <p class="question-text">
        ${escapeHtml(
          question.question_text
        )}
      </p>

      <div class="answer-options">
        ${optionsHtml}
      </div>

      <button
        id="nextQuestion"
        type="button"
        disabled
      >
        ${
          isLast
            ? 'Quiz afronden'
            : 'Volgende vraag'
        }
      </button>

      <p>
        Na 10 seconden gaat de quiz
        automatisch verder.

        Geen antwoord is fout.
      </p>

    </section>
  `)

  questionDeadline =
    Date.now() +
    SECONDS_PER_QUESTION * 1000

  const next =
    document.querySelector('#nextQuestion')

  document
    .querySelectorAll(
      'input[name="currentAnswer"]'
    )
    .forEach(input => {
      input.addEventListener('change', () => {
        if (advancing) return

        if (Date.now() >= questionDeadline) {
          finishQuestion()
          return
        }

        selectedAnswer = input.value
        next.disabled = false
      })
    })

  next.addEventListener('click', () => {
    if (advancing) return

    if (Date.now() >= questionDeadline) {
      finishQuestion()
      return
    }

    if (selectedAnswer !== null) {
      finishQuestion()
    }
  })

  timerId = setInterval(updateTimer, 100)
  updateTimer()

  window.scrollTo(0, 0)
}

// ===================================
// TIMER
// ===================================

function updateTimer() {
  if (advancing) return

  const left = Math.max(
    0,
    questionDeadline - Date.now()
  )

  const seconds = Math.ceil(left / 1000)

  const label =
    document.querySelector('#secondsLeft')

  const bar =
    document.querySelector('#timerBar')

  if (label) {
    label.textContent = seconds

    label.style.color =
      seconds <= 5 ? '#c62828' : ''
  }

  if (bar) {
    const percentage =
      left / (SECONDS_PER_QUESTION * 1000) * 100

    bar.style.width = `${percentage}%`

    bar.style.background =
      seconds <= 5
        ? '#c62828'
        : '#198754'
  }

  if (left <= 0) {
    finishQuestion()
  }
}

// ===================================
// VRAAG AFRONDEN
// ===================================

function finishQuestion() {
  if (advancing) return

  advancing = true
  stopTimer()

  const question =
    questions[currentQuestionIndex]

  quizAnswers[question.id] =
    selectedAnswer

  currentQuestionIndex++

  if (currentQuestionIndex < questions.length) {
    showQuestion()
  } else {
    saveQuiz()
  }
}

// ===================================
// KENNISQUIZ OPSLAAN
// ===================================


async function saveQuiz() {
  if (submitting) return

  submitting = true

  page(`
    <section class="quiz-card">
      <h1>Quiz afgerond</h1>
      <p>Antwoorden veilig opslaan...</p>
      <p
        id="saveError"
        class="error-message"
      ></p>
      <button
        id="retrySave"
        type="button"
        hidden
      >
        Opnieuw proberen
      </button>
    </section>
  `)

  try {
    // Supabase berekent de score.
    // De browser verstuurt alleen de
    // antwoorden A, B, C, D of null.

    const { data, error } = await supabase.rpc(
      'submit_big_five_quiz',
      {
        p_team_id: currentTeam.id,
        p_answers: quizAnswers
      }
    )

    if (error) throw error

    const correctCount = data.correct_count
    const totalQuestions =
      data.correct_count + data.incorrect_count

    // Toon de door Supabase berekende score.

    page(`
      <section class="quiz-card results-summary-card">

        <h1>✅ Kennisquiz voltooid!</h1>

        <div class="score-display">
          ${correctCount}
          van ${totalQuestions} goed
        </div>

        <p>
          Jullie antwoorden zijn veilig
          opgeslagen in Supabase.
        </p>

        <button id="home" type="button">
          Terug naar opdrachten
        </button>

      </section>
    `)

    document
      .querySelector('#home')
      .addEventListener('click', showHome)

  } catch (error) {
    console.error('Quiz opslaan mislukt:', error)

    const saveError =
      document.querySelector('#saveError')

    if (saveError) {
      saveError.textContent =
        error.message ||
        'De quiz kon niet worden opgeslagen.'
    }

    const retryButton =
      document.querySelector('#retrySave')

    if (retryButton) {
      retryButton.hidden = false

      retryButton.addEventListener('click', () => {
        saveQuiz()
      })
    }

  } finally {
    submitting = false
  }
}


// ===================================
// TIMER BIJ TERUGKOMST
// ===================================

document.addEventListener(
  'visibilitychange',
  () => {
    if (
      !document.hidden &&
      timerId !== null
    ) {
      updateTimer()
    }
  }
)

// ===================================
// APP STARTEN
// ===================================

initializeApp()
