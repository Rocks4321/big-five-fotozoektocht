
import './style.css'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'

// ==========================================
// ROCKS 'N RIVERS
// BIG FIVE FOTOZOEKTOCHT
// INSTRUCTEURSDASHBOARD
// ==========================================

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const app = document.querySelector('#app')

const PHOTO_BUCKET = 'big-five-photos'
const BOOK_BUCKET = 'big-five-photobooks'

const LOGO_FILE = 'logo-rnr.png'
const REFRESH_INTERVAL = 20000

const ACTIVITIES = [
  {
    key: 'muziekquiz',
    title: 'Muziekquiz',
    unit: 'punten',
    explanation: 'Meer punten is beter.'
  },
  {
    key: 'animal_mind',
    title: 'Animal Mind',
    unit: 'beurten',
    explanation: 'Minder beurten is beter.'
  },
  {
    key: 'gewichtige_leeuw',
    title: 'Gewichtige Leeuw',
    unit: 'fouten',
    explanation: 'Minder fouten is beter.'
  }
]

// ==========================================
// VARIABELEN
// ==========================================

let instructorUser = null
let activeSession = null

let teams = []
let submissions = []
let photoTasks = []
let photoSubmissions = []
let activityScores = []
let savedPhotoBooks = []

let selectedTeamId = null

let refreshTimer = null
let loadingDashboard = false
let generatingPhotoBooks = false
let previewingPhotoBook = false
let archivingSession = false

let displayVersion = 0

// ==========================================
// KLEUREN PDF
// ==========================================

const PDF_COLORS = {
  darkGreen: [35, 78, 52],
  green: [64, 112, 76],
  lightGreen: [232, 242, 231],
  cream: [249, 247, 239],
  white: [255, 255, 255],
  dark: [45, 49, 44],
  gray: [113, 120, 111],
  border: [205, 218, 205]
}

// ==========================================
// ALGEMENE HULPFUNCTIES
// ==========================================

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function logoHtml() {
  return `
    <div class="quiz-logo">
      <img
        src="${import.meta.env.BASE_URL}${LOGO_FILE}"
        alt="Rocks 'n Rivers"
      />
    </div>
  `
}

function formatDate(value) {
  if (!value) return '-'

  return new Date(value).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(value) {
  if (value == null) return '-'

  const seconds = Math.max(
    0,
    Number(value) || 0
  )

  return (
    `${Math.floor(seconds / 60)}:` +
    String(seconds % 60).padStart(2, '0')
  )
}

function showLoading(message) {
  app.innerHTML = `
    ${logoHtml()}
    <main class="quiz-page">
      <section class="quiz-card">
        <p>${escapeHtml(message)}</p>
      </section>
    </main>
  `
}

function setMessage(id, message, error = false) {
  const element = document.getElementById(id)

  if (!element) return

  element.textContent = message
  element.style.color = error
    ? '#a12626'
    : '#28613d'
}

function stopRefreshing() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function isBusy() {
  return (
    loadingDashboard ||
    generatingPhotoBooks ||
    previewingPhotoBook ||
    archivingSession
  )
}

function getTeamQuiz(teamId) {
  return submissions.find(
    row => row.team_id === teamId
  ) || null
}

function getTeamPhotos(teamId) {
  return photoSubmissions.filter(
    row => row.team_id === teamId
  )
}

function getTeamScore(teamId, activity) {
  return activityScores.find(
    row =>
      row.team_id === teamId &&
      row.activity_name === activity
  ) || null
}

function scoreText(teamId, activity, unit) {
  const row = getTeamScore(teamId, activity)

  return row
    ? `${row.score} ${unit}`
    : '—'
}

function reviewText(status) {
  if (status === 'approved') {
    return '✅ Goedgekeurd'
  }

  if (status === 'rejected') {
    return '❌ Afgekeurd'
  }

  return '⏳ Wacht op beoordeling'
}

function pdfPath(team) {
  return `${activeSession.id}/${team.id}.pdf`
}

function safeFilename(value) {
  return (
    String(value)
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .slice(0, 55)
    || 'Team'
  )
}

// ==========================================
// INLOGGEN
// ==========================================

function renderLogin(message = '') {
  stopRefreshing()
  displayVersion++

  instructorUser = null
  selectedTeamId = null

  app.innerHTML = `
    ${logoHtml()}

    <main class="quiz-page">
      <section class="quiz-card start-card">

        <h1>Instructeur inloggen</h1>

        <p>
          Big Five Fotozoektocht
        </p>

        <form id="loginForm">

          <label for="loginEmail">
            E-mailadres
          </label>

          <input
            id="loginEmail"
            type="email"
            required
            autocomplete="username"
          />

          <label for="loginPassword">
            Wachtwoord
          </label>

          <input
            id="loginPassword"
            type="password"
            required
            autocomplete="current-password"
          />

          <button
            id="loginButton"
            type="submit"
          >
            Inloggen
          </button>

        </form>

        <p
          id="loginError"
          class="error-message"
          role="alert"
        >
          ${escapeHtml(message)}
        </p>

      </section>
    </main>
  `

  document
    .getElementById('loginForm')
    .addEventListener('submit', handleLogin)
}

async function handleLogin(event) {
  event.preventDefault()

  const email = document
    .getElementById('loginEmail')
    .value.trim()

  const password = document
    .getElementById('loginPassword')
    .value

  const button =
    document.getElementById('loginButton')

  button.disabled = true
  button.textContent = 'Inloggen...'

  const { error } =
    await supabase.auth.signInWithPassword({
      email,
      password
    })

  if (error) {
    setMessage(
      'loginError',
      'Inloggen mislukt. Controleer je gegevens.',
      true
    )

    button.disabled = false
    button.textContent = 'Inloggen'

    return
  }

  await checkInstructor()
}

async function checkInstructor() {
  showLoading('Instructeursaccount controleren...')

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser()

  if (
    userError ||
    !user ||
    user.is_anonymous
  ) {
    renderLogin()
    return
  }

  const { data, error } = await supabase
    .from('instructors')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) {
    await supabase.auth.signOut()

    renderLogin(
      'Dit account heeft geen instructeursrechten.'
    )

    return
  }

  instructorUser = user

  await startDashboard()
}

// ==========================================
// DATA LADEN
// ==========================================

async function loadDashboardData() {
  if (loadingDashboard) return false

  loadingDashboard = true

  try {
    const {
      data: sessions,
      error: sessionError
    } = await supabase
      .from('game_sessions')
      .select('id, name, status, created_at')
      .eq('status', 'active')
      .order('created_at', {
        ascending: false
      })
      .limit(1)

    if (sessionError) throw sessionError

    const session = sessions?.[0] || null

    if (!session) {
      activeSession = null
      teams = []
      submissions = []
      photoTasks = []
      photoSubmissions = []
      activityScores = []
      savedPhotoBooks = []

      return true
    }

    const [
      teamsResult,
      quizzesResult,
      tasksResult,
      photosResult,
      scoresResult,
      booksResult
    ] = await Promise.all([

      supabase
        .from('game_teams')
        .select(
          'id, team_name, session_id, created_at'
        )
        .eq('session_id', session.id)
        .order('created_at'),

      supabase
        .from('submissions')
        .select(`
          id,
          team_id,
          team_name,
          correct_count,
          incorrect_count,
          duration_seconds,
          submitted_at
        `)
        .order('submitted_at', {
          ascending: false
        }),

      supabase
        .from('photo_tasks')
        .select('id, title, description')
        .order('id'),

      supabase
        .from('photo_submissions')
        .select(`
          id,
          team_id,
          task_id,
          photo_path,
          submitted_at,
          review_status,
          reviewed_at
        `),

      supabase
        .from('activity_scores')
        .select(`
          id,
          team_id,
          activity_name,
          score,
          updated_at
        `),

      supabase
        .from('team_photo_books')
        .select('id, team_id, storage_path')

    ])

    for (const result of [
      teamsResult,
      quizzesResult,
      tasksResult,
      photosResult,
      scoresResult,
      booksResult
    ]) {
      if (result.error) {
        throw result.error
      }
    }

    const loadedTeams = teamsResult.data || []

    const teamIds = new Set(
      loadedTeams.map(team => team.id)
    )

    activeSession = session
    teams = loadedTeams
    photoTasks = tasksResult.data || []

    submissions = (quizzesResult.data || [])
      .filter(row => teamIds.has(row.team_id))

    photoSubmissions = (photosResult.data || [])
      .filter(row => teamIds.has(row.team_id))

    activityScores = (scoresResult.data || [])
      .filter(row => teamIds.has(row.team_id))

    savedPhotoBooks = (booksResult.data || [])
      .filter(row => teamIds.has(row.team_id))

    return true

  } catch (error) {
    console.error(error)

    alert(
      'Dashboard laden mislukt: ' +
      (error.message || 'Onbekende fout')
    )

    return false

  } finally {
    loadingDashboard = false
  }
}

// ==========================================
// DASHBOARD STARTEN
// ==========================================

async function startDashboard() {
  stopRefreshing()

  selectedTeamId = null

  showLoading('Dashboard laden...')

  const success = await loadDashboardData()

  if (!success) return

  renderDashboard()

  refreshTimer = setInterval(async () => {
    if (
      selectedTeamId ||
      isBusy()
    ) {
      return
    }

    await refreshDashboard(false)

  }, REFRESH_INTERVAL)
}

async function refreshDashboard(feedback = true) {
  if (isBusy()) return

  const previousTeam = selectedTeamId

  const success = await loadDashboardData()

  if (!success) return

  selectedTeamId = teams.some(
    team => team.id === previousTeam
  )
    ? previousTeam
    : null

  renderDashboard()

  if (feedback) {
    setMessage(
      'dashboardMessage',
      '✅ Overzicht bijgewerkt.'
    )
  }
}

// ==========================================
// DASHBOARD TONEN
// ==========================================

function renderDashboard() {
  displayVersion++

  const completedQuizzes = teams.filter(
    team => !!getTeamQuiz(team.id)
  ).length

  const pendingPhotos = photoSubmissions.filter(
    photo => photo.review_status === 'pending'
  ).length

  const completedBooks = teams.filter(
    team => savedPhotoBooks.some(
      book =>
        book.team_id === team.id &&
        book.storage_path === pdfPath(team)
    )
  ).length

  app.innerHTML = `
    ${logoHtml()}

    <main class="dashboard-page">

      <section class="quiz-card">

        <h1>
          Big Five Instructeursdashboard
        </h1>

        <p>
          Ingelogd als:
          <strong>
            ${escapeHtml(instructorUser.email)}
          </strong>
        </p>

        <button
          id="logoutButton"
          type="button"
        >
          Uitloggen
        </button>

      </section>

      <section class="quiz-card">

        <h2>
          ${
            activeSession
              ? escapeHtml(activeSession.name)
              : 'Geen actief programma'
          }
        </h2>

        <button
          id="refreshButton"
          type="button"
        >
          🔄 Overzicht vernieuwen
        </button>

        <p
          id="dashboardMessage"
          role="status"
        ></p>

      </section>

      <section class="quiz-card">

        <h2>Programma-overzicht</h2>

        <p>
          <strong>Actieve teams:</strong>
          ${teams.length}
        </p>

        <p>
          <strong>Kennisquiz afgerond:</strong>
          ${completedQuizzes}
        </p>

        <p>
          <strong>Foto's ontvangen:</strong>
          ${photoSubmissions.length}
        </p>

        <p>
          <strong>Wachten op beoordeling:</strong>
          ${pendingPhotos}
        </p>

      </section>

      <section class="quiz-card">

        <h2>Alle actieve teams</h2>

        ${renderTeamList()}

      </section>

      <div id="teamDetails">
        ${
          selectedTeamId
            ? renderTeamDetails()
            : ''
        }
      </div>

      
      <section class="quiz-card">

        <h2>📖 Fotoboekjes</h2>

        <p>
          Maak voor ieder team een eigen fotoboekje
          met het Rocks 'n Rivers-logo,
          de zes foto-opdrachten
          en een bedankpagina.
        </p>

        <p>
          <strong>Opgeslagen:</strong>
          ${completedBooks} van ${teams.length}
        </p>

        <button
          id="generatePhotoBooksButton"
          type="button"
          ${
            !teams.length || isBusy()
              ? 'disabled'
              : ''
          }
        >
          📖 Ontbrekende fotoboekjes maken
        </button>

        <div
          id="photoBookResults"
          role="status"
          style="margin-top:20px;"
        ></div>

      </section>


      <section class="quiz-card">

        <h2>🏁 Spel beëindigen</h2>

        <p>
          Nadat voor ieder team een
          fotoboekje is opgeslagen,
          kan het programma worden afgesloten.
        </p>

        <p>
          Het oude programma blijft
          bewaard in Supabase.
          Het dashboard begint opnieuw
          met een lege spelronde.
        </p>

        <button
          id="archiveSessionButton"
          type="button"
          ${
            !activeSession ||
            !teams.length ||
            completedBooks !== teams.length ||
            isBusy()
              ? 'disabled'
              : ''
          }
        >
          🏁 Spel beëindigen en nieuw spel starten
        </button>

        <p
          id="archiveMessage"
          role="alert"
        ></p>

      </section>

    </main>
  `

  bindDashboardEvents()

  showSavedPhotoBooks(displayVersion)
}

// ==========================================
// TEAMOVERZICHT
// ==========================================

function renderTeamList() {
  if (!teams.length) {
    return `
      <p>Er zijn nog geen teams gestart.</p>
    `
  }

  const rows = teams.map(team => {
    const quiz = getTeamQuiz(team.id)
    const photos = getTeamPhotos(team.id)

    const quizText = quiz
      ? `${quiz.correct_count} goed`
      : 'Nog niet gemaakt'

    return `
      <tr>
        <td>
          <strong>
            ${escapeHtml(team.team_name)}
          </strong>
        </td>

        <td>${escapeHtml(quizText)}</td>

        <td>
          ${photos.length} / ${photoTasks.length}
        </td>

        <td>
          ${escapeHtml(
            scoreText(
              team.id,
              'muziekquiz',
              'punten'
            )
          )}
        </td>

        <td>
          ${escapeHtml(
            scoreText(
              team.id,
              'animal_mind',
              'beurten'
            )
          )}
        </td>

        <td>
          ${escapeHtml(
            scoreText(
              team.id,
              'gewichtige_leeuw',
              'fouten'
            )
          )}
        </td>

        <td>
          <button
            class="openTeamButton"
            type="button"
            data-team-id="${escapeHtml(team.id)}"
          >
            ${
              selectedTeamId === team.id
                ? 'Sluiten'
                : 'Bekijken'
            }
          </button>
        </td>
      </tr>
    `
  }).join('')

  return `
    <div style="overflow-x:auto;">

      <table
        border="1"
        style="
          width:100%;
          min-width:950px;
          border-collapse:collapse;
          text-align:center;
        "
      >
        <thead>
          <tr>
            <th>Team</th>
            <th>Kennisquiz</th>
            <th>Foto's</th>
            <th>Muziekquiz</th>
            <th>Animal Mind</th>
            <th>Gewichtige Leeuw</th>
            <th>Details</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>

    </div>
  `
}

// ==========================================
// TEAMDETAILS
// ==========================================

function renderTeamDetails() {
  const team = teams.find(
    row => row.id === selectedTeamId
  )

  if (!team) return ''

  const quiz = getTeamQuiz(team.id)

  return `
    <section class="quiz-card">

      <h2>
        Team: ${escapeHtml(team.team_name)}
      </h2>

      <p>
        Gestart:
        ${formatDate(team.created_at)}
      </p>

      <button
        id="closeTeamButton"
        type="button"
      >
        Sluiten
      </button>

    </section>

    <section class="quiz-card">

      <h2>🧠 Kennisquiz</h2>

      ${
        quiz
          ? `
            <p>
              ✅ ${quiz.correct_count} goed,
              ${quiz.incorrect_count} fout
            </p>

            <p>
              Tijd:
              ${formatDuration(quiz.duration_seconds)}
            </p>

            <button
              id="showQuizAnswers"
              type="button"
              data-submission-id="${quiz.id}"
            >
              Bekijk quizantwoorden
            </button>

            <div
              id="quizAnswerDetails"
              hidden
            ></div>
          `
          : '<p>⏳ Nog niet gemaakt</p>'
      }

    </section>

    <section class="quiz-card">

      <h2>📸 Foto-opdrachten</h2>

      ${renderTeamPhotoTasks(team.id)}

    </section>

    <section class="quiz-card">

      <h2>Doe-opdrachten</h2>

      ${renderActivityInputs(team.id)}

    </section>
  `
}

// ==========================================
// FOTO-OPDRACHTEN
// ==========================================

function renderTeamPhotoTasks(teamId) {
  return photoTasks.map(task => {
    const photo = photoSubmissions.find(
      row =>
        row.team_id === teamId &&
        row.task_id === task.id
    )

    if (!photo) {
      return `
        <div class="dashboard-question">

          <h3>Foto-opdracht ${task.id}</h3>

          <p>
            ${escapeHtml(
              task.description || task.title
            )}
          </p>

          <p>○ Nog niet ingestuurd</p>

        </div>
      `
    }

    return `
      <div class="dashboard-question">

        <h3>Foto-opdracht ${task.id}</h3>

        <p>
          ${escapeHtml(
            task.description || task.title
          )}
        </p>

        <p>
          Ingestuurd:
          ${formatDate(photo.submitted_at)}
        </p>

        <p>
          <strong>
            ${reviewText(photo.review_status)}
          </strong>
        </p>

        <button
          class="viewPhotoButton"
          type="button"
          data-photo-id="${escapeHtml(photo.id)}"
        >
          📷 Bekijk foto
        </button>

        <button
          class="approvePhotoButton"
          type="button"
          data-photo-id="${escapeHtml(photo.id)}"
        >
          ✅ Goedkeuren
        </button>

        <button
          class="rejectPhotoButton"
          type="button"
          data-photo-id="${escapeHtml(photo.id)}"
        >
          ❌ Afkeuren
        </button>

        <div
          id="photoPreview-${photo.id}"
          style="margin-top:15px;"
        ></div>

        <p
          id="photoMessage-${photo.id}"
          role="status"
        ></p>

      </div>
    `
  }).join('')
}

async function viewPhoto(photoId) {
  const photo = photoSubmissions.find(
    row => row.id === photoId
  )

  if (!photo) return

  const container = document.getElementById(
    `photoPreview-${photoId}`
  )

  if (!container) return

  container.textContent = 'Foto laden...'

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(photo.photo_path, 120)

  if (error || !data?.signedUrl) {
    container.textContent =
      'Foto openen mislukt.'
    return
  }

  const image = document.createElement('img')

  image.src = data.signedUrl
  image.alt = 'Ingestuurde teamfoto'

  image.style.width = '100%'
  image.style.maxWidth = '650px'
  image.style.maxHeight = '650px'
  image.style.objectFit = 'contain'
  image.style.borderRadius = '12px'

  container.replaceChildren(image)
}

async function reviewPhoto(photoId, status) {
  if (
    status !== 'approved' &&
    status !== 'rejected'
  ) return

  const action = status === 'approved'
    ? 'goedkeuren'
    : 'afkeuren'

  if (!confirm(`Wil je deze foto ${action}?`)) {
    return
  }

  setMessage(
    `photoMessage-${photoId}`,
    'Beoordeling opslaan...'
  )

  const { error } = await supabase
    .from('photo_submissions')
    .update({
      review_status: status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: instructorUser.id
    })
    .eq('id', photoId)

  if (error) {
    setMessage(
      `photoMessage-${photoId}`,
      'Opslaan mislukt: ' + error.message,
      true
    )
    return
  }

  await refreshDashboard(false)
}

// ==========================================
// DOE-OPDRACHTEN
// ==========================================

function renderActivityInputs(teamId) {
  return ACTIVITIES.map(activity => {
    const existing = getTeamScore(
      teamId,
      activity.key
    )

    return `
      <div class="dashboard-question">

        <h3>
          ${escapeHtml(activity.title)}
        </h3>

        <p>
          ${escapeHtml(activity.explanation)}
        </p>

        <label for="score-${activity.key}">
          Aantal ${escapeHtml(activity.unit)}
        </label>

        <input
          id="score-${activity.key}"
          type="number"
          min="0"
          step="1"
          value="${existing?.score ?? ''}"
        />

        <button
          class="saveActivityButton"
          type="button"
          data-team-id="${escapeHtml(teamId)}"
          data-activity="${activity.key}"
        >
          Score opslaan
        </button>

        <p
          id="scoreMessage-${activity.key}"
          role="status"
        ></p>

      </div>
    `
  }).join('')
}

async function saveActivityScore(
  teamId,
  activityName
) {
  const input = document.getElementById(
    `score-${activityName}`
  )

  if (!input) return

  const raw = input.value.trim()
  const score = Number(raw)

  if (
    raw === '' ||
    !Number.isSafeInteger(score) ||
    score < 0
  ) {
    setMessage(
      `scoreMessage-${activityName}`,
      'Vul een geheel getal van 0 of hoger in.',
      true
    )
    return
  }

  const existing = getTeamScore(
    teamId,
    activityName
  )

  const values = {
    score,
    updated_at: new Date().toISOString(),
    updated_by: instructorUser.id
  }

  const result = existing
    ? await supabase
        .from('activity_scores')
        .update(values)
        .eq('id', existing.id)
    : await supabase
        .from('activity_scores')
        .insert({
          team_id: teamId,
          activity_name: activityName,
          ...values
        })

  if (result.error) {
    setMessage(
      `scoreMessage-${activityName}`,
      'Opslaan mislukt: ' +
        result.error.message,
      true
    )
    return
  }

  setMessage(
    `scoreMessage-${activityName}`,
    '✅ Score opgeslagen!'
  )

  await loadDashboardData()
}

// ==========================================
// QUIZANTWOORDEN
// ==========================================

async function showQuizAnswers(submissionId) {
  const container = document.getElementById(
    'quizAnswerDetails'
  )

  if (!container) return

  if (!container.hidden) {
    container.hidden = true
    container.replaceChildren()
    return
  }

  container.hidden = false
  container.textContent = 'Antwoorden laden...'

  const { data, error } = await supabase
    .from('submission_answers')
    .select(`
      selected_answer,
      is_correct,
      questions (
        question_number,
        question_text,
        correct_answer,
        explanation
      )
    `)
    .eq('submission_id', submissionId)

  if (error) {
    container.textContent =
      'Antwoorden ophalen mislukt.'
    return
  }

  const sorted = [...(data || [])].sort(
    (a, b) =>
      Number(a.questions?.question_number || 0) -
      Number(b.questions?.question_number || 0)
  )

  container.innerHTML = sorted.map(row => `
    <div class="dashboard-question">

      <h3>
        Vraag ${
          escapeHtml(
            row.questions?.question_number
          )
        }
      </h3>

      <p>
        ${
          escapeHtml(
            row.questions?.question_text
          )
        }
      </p>

      <p>
        Gegeven antwoord:
        ${
          escapeHtml(
            row.selected_answer ?? 'Niet ingevuld'
          )
        }
      </p>

      <p>
        Juiste antwoord:
        ${
          escapeHtml(
            row.questions?.correct_answer
          )
        }
      </p>

      <p>
        ${
          row.is_correct
            ? '✅ Goed'
            : '❌ Fout'
        }
      </p>

      <p>
        ${
          escapeHtml(
            row.questions?.explanation || ''
          )
        }
      </p>

    </div>
  `).join('')
}

// ==========================================
// PDF HULPFUNCTIES
// ==========================================

function pdfColor(pdf, type, color) {
  if (type === 'text') {
    pdf.setTextColor(...color)
  }

  if (type === 'fill') {
    pdf.setFillColor(...color)
  }

  if (type === 'draw') {
    pdf.setDrawColor(...color)
  }
}

function pdfCleanText(value) {
  // Standaard PDF-lettertypes ondersteunen
  // niet alle emoji en speciale symbolen.

  return String(value ?? '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, '-')
    .replace(/•/g, '-')
}

function pdfMultiline(
  pdf,
  text,
  x,
  y,
  width,
  fontSize = 12,
  lineHeight = 7
) {
  pdf.setFontSize(fontSize)

  const lines = pdf.splitTextToSize(
    pdfCleanText(text),
    width
  )

  pdf.text(lines, x, y)

  return y + lines.length * lineHeight
}

function pdfCentered(
  pdf,
  text,
  x,
  y,
  width,
  fontSize = 12,
  lineHeight = 8
) {
  pdf.setFontSize(fontSize)

  const lines = pdf.splitTextToSize(
    pdfCleanText(text),
    width
  )

  pdf.text(lines, x, y, {
    align: 'center'
  })

  return y + lines.length * lineHeight
}

function pdfPageBackground(pdf) {
  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.cream
  )

  pdf.rect(0, 0, 210, 297, 'F')
}

function pdfFooter(pdf, teamName) {
  pdfColor(
    pdf,
    'draw',
    PDF_COLORS.border
  )

  pdf.line(18, 275, 192, 275)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.gray
  )

  pdf.text(
    pdfCleanText(teamName).slice(0, 42),
    18,
    283
  )

  pdf.text(
    "ROCKS 'N RIVERS",
    105,
    283,
    { align: 'center' }
  )

  pdf.text(
    String(pdf.getCurrentPageInfo().pageNumber),
    192,
    283,
    { align: 'right' }
  )
}

async function loadLogoForPdf() {
  const url =
    `${import.meta.env.BASE_URL}${LOGO_FILE}`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      'Rocks n Rivers-logo niet gevonden. ' +
      'Controleer public/logo-rnr.png.'
    )
  }

  const blob = await response.blob()

  if (
    blob.type !== 'image/png' &&
    blob.type !== 'image/jpeg'
  ) {
    throw new Error(
      'Gebruik een PNG- of JPG-logo.'
    )
  }

  return new Uint8Array(
    await blob.arrayBuffer()
  )
}

function pdfLogo(
  pdf,
  logoBytes,
  centerX,
  y,
  maxWidth,
  maxHeight
) {
  const info = pdf.getImageProperties(logoBytes)

  const scale = Math.min(
    maxWidth / info.width,
    maxHeight / info.height
  )

  const width = info.width * scale
  const height = info.height * scale

  pdf.addImage(
    logoBytes,
    info.fileType,
    centerX - width / 2,
    y + (maxHeight - height) / 2,
    width,
    height
  )
}

async function loadPhotoForPdf(path) {
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .download(path)

  if (error || !data) {
    throw new Error(
      'Foto downloaden mislukt: ' +
      (error?.message || path)
    )
  }

  return new Uint8Array(
    await data.arrayBuffer()
  )
}

// ==========================================
// PDF VOORBLAD
// ==========================================

function drawPdfCover(
  pdf,
  team,
  logoBytes,
  sessionName
) {
  pdfPageBackground(pdf)

  // Groene bovenbalk

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.darkGreen
  )

  pdf.rect(0, 0, 210, 24, 'F')

  // Grote lichte kaart

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.white
  )

  pdf.roundedRect(
    17,
    38,
    176,
    213,
    6,
    6,
    'F'
  )

  // Logo, met behoud van verhoudingen

  pdfLogo(
    pdf,
    logoBytes,
    105,
    55,
    115,
    44
  )

  pdf.setFont('helvetica', 'bold')
  pdfColor(
    pdf,
    'text',
    PDF_COLORS.darkGreen
  )

  pdf.setFontSize(25)

  pdf.text(
    'BIG FIVE',
    105,
    118,
    { align: 'center' }
  )

  pdf.setFontSize(17)

  pdf.text(
    'FOTOZOEKTOCHT',
    105,
    131,
    { align: 'center' }
  )

  pdfColor(
    pdf,
    'draw',
    PDF_COLORS.green
  )

  pdf.setLineWidth(0.8)
  pdf.line(50, 144, 160, 144)

  pdf.setFont('helvetica', 'bold')

  pdfCentered(
    pdf,
    team.team_name,
    105,
    164,
    152,
    22,
    10
  )

  pdf.setFont('helvetica', 'italic')

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.green
  )

  pdfCentered(
    pdf,
    'Herinneringen aan jullie safari',
    105,
    198,
    150,
    14
  )

  pdf.setFont('helvetica', 'normal')

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.gray
  )

  pdfCentered(
    pdf,
    sessionName,
    105,
    221,
    145,
    10
  )

  pdf.setFontSize(10)

  pdf.text(
    new Date().toLocaleDateString('nl-NL'),
    105,
    238,
    { align: 'center' }
  )

  // Onderste groene balk

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.darkGreen
  )

  pdf.rect(0, 268, 210, 29, 'F')

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.white
  )

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)

  pdf.text(
    "Een avontuur van Rocks 'n Rivers",
    105,
    284,
    { align: 'center' }
  )
}

// ==========================================
// PDF INHOUDSPAGINA
// ==========================================

function drawPdfContents(
  pdf,
  team,
  logoBytes,
  tasks
) {
  pdf.addPage()
  pdfPageBackground(pdf)

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.darkGreen
  )

  pdf.rect(0, 0, 210, 14, 'F')

  pdfLogo(
    pdf,
    logoBytes,
    105,
    25,
    70,
    27
  )

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(23)

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.darkGreen
  )

  pdf.text(
    'Jullie safari-avontuur',
    18,
    77
  )

  pdf.setFont('helvetica', 'normal')

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.dark
  )

  pdfMultiline(
    pdf,
    'Zes foto-opdrachten en jullie ' +
    'mooiste herinneringen aan de safari.',
    18,
    91,
    174,
    12
  )

  let y = 117

  tasks.forEach((task, index) => {
    const taskName =
      task.description ||
      task.title ||
      `Foto-opdracht ${index + 1}`

    const lines = pdf.splitTextToSize(
      pdfCleanText(taskName),
      140
    )

    const rowHeight = Math.max(
      19,
      lines.length * 6 + 11
    )

    pdfColor(
      pdf,
      'fill',
      index % 2 === 0
        ? PDF_COLORS.lightGreen
        : PDF_COLORS.white
    )

    pdf.roundedRect(
      18,
      y,
      174,
      rowHeight,
      3,
      3,
      'F'
    )

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)

    pdfColor(
      pdf,
      'text',
      PDF_COLORS.darkGreen
    )

    pdf.text(
      String(task.id),
      27,
      y + 11
    )

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)

    pdfColor(
      pdf,
      'text',
      PDF_COLORS.dark
    )

    pdf.text(
      lines,
      43,
      y + 9
    )

    y += rowHeight + 5
  })

  pdfFooter(pdf, team.team_name)
}

// ==========================================
// PDF FOTO-OPDRACHT
// ==========================================

async function drawPdfTaskPage(
  pdf,
  team,
  task,
  photo,
  logoBytes
) {
  pdf.addPage()
  pdfPageBackground(pdf)

  // Groene balk bovenaan

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.darkGreen
  )

  pdf.rect(0, 0, 210, 13, 'F')

  // Klein logo

  pdfLogo(
    pdf,
    logoBytes,
    37,
    22,
    37,
    22
  )

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.darkGreen
  )

  pdf.text(
    `Foto-opdracht ${task.id}`,
    18,
    63
  )

  // Opdrachtbox, met automatische hoogte

  const text = pdfCleanText(
    task.description || task.title
  )

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(12)

  const lines = pdf.splitTextToSize(
    text,
    158
  )

  const boxHeight = Math.max(
    33,
    lines.length * 7 + 17
  )

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.lightGreen
  )

  pdf.roundedRect(
    18,
    74,
    174,
    boxHeight,
    4,
    4,
    'F'
  )

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.dark
  )

  pdf.text(
    lines,
    26,
    86
  )

  const photoTop = 74 + boxHeight + 11
  const photoBottom = 262

  const photoMaxWidth = 174
  const photoMaxHeight =
    photoBottom - photoTop

  if (!photo) {
    pdfColor(
      pdf,
      'fill',
      PDF_COLORS.white
    )

    pdfColor(
      pdf,
      'draw',
      PDF_COLORS.border
    )

    pdf.roundedRect(
      18,
      photoTop,
      174,
      photoMaxHeight,
      4,
      4,
      'FD'
    )

    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(14)

    pdfColor(
      pdf,
      'text',
      PDF_COLORS.gray
    )

    pdf.text(
      'Geen foto ingestuurd',
      105,
      photoTop + photoMaxHeight / 2,
      { align: 'center' }
    )
  } else {
    const bytes =
      await loadPhotoForPdf(photo.photo_path)

    const info =
      pdf.getImageProperties(bytes)

    const scale = Math.min(
      photoMaxWidth / info.width,
      photoMaxHeight / info.height
    )

    const imageWidth = info.width * scale
    const imageHeight = info.height * scale

    const x = (210 - imageWidth) / 2

    const y =
      photoTop +
      (photoMaxHeight - imageHeight) / 2

    // Achtergrond voor de foto

    pdfColor(
      pdf,
      'fill',
      PDF_COLORS.white
    )

    pdf.roundedRect(
      18,
      photoTop,
      174,
      photoMaxHeight,
      4,
      4,
      'F'
    )

    pdf.addImage(
      bytes,
      info.fileType,
      x,
      y,
      imageWidth,
      imageHeight
    )
  }

  pdfFooter(pdf, team.team_name)
}

// ==========================================
// PDF BEDANKPAGINA
// ==========================================

function drawPdfThankYou(
  pdf,
  team,
  logoBytes
) {
  pdf.addPage()

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.darkGreen
  )

  pdf.rect(0, 0, 210, 297, 'F')

  // Wit vlak

  pdfColor(
    pdf,
    'fill',
    PDF_COLORS.white
  )

  pdf.roundedRect(
    19,
    39,
    172,
    217,
    6,
    6,
    'F'
  )

  pdfLogo(
    pdf,
    logoBytes,
    105,
    65,
    100,
    45
  )

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(25)

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.darkGreen
  )

  pdf.text(
    'Bedankt!',
    105,
    138,
    { align: 'center' }
  )

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(14)

  pdfCentered(
    pdf,
    'Wat leuk dat jullie hebben ' +
    'meegedaan aan de Big Five Fotozoektocht!',
    105,
    162,
    140,
    14,
    9
  )

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)

  pdfCentered(
    pdf,
    team.team_name,
    105,
    205,
    140,
    17
  )

  pdf.setFont('helvetica', 'italic')
  pdf.setFontSize(12)

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.green
  )

  pdf.text(
    'Herinneringen aan jullie safari',
    105,
    235,
    { align: 'center' }
  )

  pdfColor(
    pdf,
    'text',
    PDF_COLORS.white
  )

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)

  pdf.text(
    "Rocks 'n Rivers",
    105,
    280,
    { align: 'center' }
  )
}

// ==========================================
// COMPLETE NIEUWE PDF MAKEN
// ==========================================

async function createTeamPhotoBook(team) {
  if (!activeSession) {
    throw new Error(
      'Er is geen actief programma.'
    )
  }

  const logoBytes = await loadLogoForPdf()

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  })

  pdf.setProperties({
    title:
      `Big Five Fotozoektocht - ${team.team_name}`,
    subject:
      'Herinneringen aan jullie safari',
    author:
      "Rocks 'n Rivers",
    creator:
      'Big Five Fotozoektocht'
  })


  // Voorblad

  drawPdfCover(
    pdf,
    team,
    logoBytes,
    activeSession.name
  )

  // Direct naar de zes foto-opdrachten.
  // Er wordt GEEN inhoudspagina gemaakt.

  // Alle foto-opdrachten


  const teamPhotos =
    getTeamPhotos(team.id)

  for (const task of photoTasks) {
    const photo = teamPhotos.find(
      row => row.task_id === task.id
    )

    await drawPdfTaskPage(
      pdf,
      team,
      task,
      photo,
      logoBytes
    )
  }

  // Bedankpagina

  drawPdfThankYou(
    pdf,
    team,
    logoBytes
  )

  return pdf
}

// ==========================================
// NIEUWE VORMGEVING BEKIJKEN
// ==========================================

async function previewTeamPhotoBook() {
  if (isBusy()) return

  const select = document.getElementById(
    'previewTeamSelect'
  )

  if (!select) return

  const team = teams.find(
    item => item.id === select.value
  )

  if (!team) return

  previewingPhotoBook = true

  const button = document.getElementById(
    'previewPhotoBookButton'
  )

  if (button) {
    button.disabled = true
    button.textContent = 'PDF maken...'
  }

  setMessage(
    'previewBookMessage',
    `Voorbeeld voor ${team.team_name} maken...`
  )

  try {
    const pdf = await createTeamPhotoBook(team)

    pdf.save(
      `Big-Five-Voorbeeld-${safeFilename(
        team.team_name
      )}.pdf`
    )

    setMessage(
      'previewBookMessage',
      '✅ PDF gedownload. ' +
      'Open het bestand om de nieuwe ' +
      'vormgeving te bekijken.'
    )
  } catch (error) {
    console.error(error)

    setMessage(
      'previewBookMessage',
      'Voorbeeld maken mislukt: ' +
      (error.message || 'Onbekende fout'),
      true
    )
  } finally {
    previewingPhotoBook = false

    if (button?.isConnected) {
      button.disabled = false
      button.textContent =
        '👀 Nieuwe PDF bekijken'
    }
  }
}

// ==========================================
// FOTOBOEKJE OPSLAAN IN SUPABASE
// ==========================================

async function saveTeamPhotoBook(team) {
  const path = pdfPath(team)

  // Bestaande boekjes niet overschrijven.

  const {
    data: existing,
    error: existingError
  } = await supabase
    .from('team_photo_books')
    .select('id, storage_path')
    .eq('team_id', team.id)
    .maybeSingle()

  if (existingError) throw existingError

  if (existing) {
    if (existing.storage_path !== path) {
      throw new Error(
        'Het bestaande PDF-pad klopt niet.'
      )
    }

    return path
  }

  // Controleren of bestand al in Storage staat.

  const {
    data: files,
    error: listError
  } = await supabase.storage
    .from(BOOK_BUCKET)
    .list(activeSession.id, {
      search: `${team.id}.pdf`,
      limit: 100
    })

  if (listError) throw listError

  const exists = (files || []).some(
    file => file.name === `${team.id}.pdf`
  )

  if (!exists) {
    const pdf =
      await createTeamPhotoBook(team)

    const blob = pdf.output('blob')

    if (blob.size > 50 * 1024 * 1024) {
      throw new Error(
        'De PDF is groter dan 50 MB.'
      )
    }

    const { error: uploadError } =
      await supabase.storage
        .from(BOOK_BUCKET)
        .upload(path, blob, {
          contentType: 'application/pdf',
          upsert: false
        })

    if (uploadError) {
      throw uploadError
    }
  }

  // Registreren

  const { error: insertError } =
    await supabase
      .from('team_photo_books')
      .insert({
        team_id: team.id,
        storage_path: path
      })

  if (insertError) throw insertError

  return path
}

// ==========================================
// PDF-DOWNLOADLINK MAKEN
// ==========================================

async function addPhotoBookLink(
  container,
  team,
  path
) {
  const { data, error } =
    await supabase.storage
      .from(BOOK_BUCKET)
      .createSignedUrl(path, 3600, {
        download:
          `Big-Five-${safeFilename(
            team.team_name
          )}.pdf`
      })

  if (error || !data?.signedUrl) {
    throw new Error(
      'Downloadlink maken mislukt: ' +
      (error?.message || 'Onbekende fout')
    )
  }

  const row = document.createElement('p')
  const link = document.createElement('a')

  link.href = data.signedUrl
  link.target = '_blank'
  link.rel = 'noopener noreferrer'

  link.textContent =
    `📄 ${team.team_name} - PDF openen`

  row.appendChild(link)
  container.appendChild(row)
}

// ==========================================
// OPGESLAGEN FOTOBOEKJES TONEN
// ==========================================

async function showSavedPhotoBooks(version) {
  if (generatingPhotoBooks) return

  const container = document.getElementById(
    'photoBookResults'
  )

  if (!container || !activeSession) return

  const sessionId = activeSession.id

  const existing = teams.map(team => ({
    team,
    book: savedPhotoBooks.find(
      book => book.team_id === team.id
    )
  })).filter(item =>
    item.book &&
    item.book.storage_path ===
      `${sessionId}/${item.team.id}.pdf`
  )

  container.replaceChildren()

  if (!existing.length) {
    container.textContent =
      'Er zijn nog geen fotoboekjes opgeslagen.'
    return
  }

  const heading = document.createElement('h3')

  heading.textContent =
    `📚 Opgeslagen fotoboekjes (${existing.length})`

  container.appendChild(heading)

  for (const { team, book } of existing) {
    if (
      version !== displayVersion ||
      !container.isConnected
    ) {
      return
    }

    try {
      await addPhotoBookLink(
        container,
        team,
        book.storage_path
      )
    } catch (error) {
      const line = document.createElement('p')

      line.style.color = '#a12626'
      line.textContent =
        `❌ ${team.team_name}: ` +
        (error.message || 'PDF niet beschikbaar')

      container.appendChild(line)
    }
  }
}

// ==========================================
// ONTBREKENDE FOTOBOEKJES MAKEN
// ==========================================

async function generateAllPhotoBooks() {
  if (isBusy()) return

  if (!activeSession || !teams.length) {
    alert('Er zijn geen actieve teams.')
    return
  }

  if (!confirm(
    'De ontbrekende fotoboekjes maken?\n\n' +
    'Bestaande boekjes blijven ongewijzigd.\n' +
    'Er worden geen e-mails verstuurd.'
  )) {
    return
  }

  generatingPhotoBooks = true

  const button = document.getElementById(
    'generatePhotoBooksButton'
  )

  const container = document.getElementById(
    'photoBookResults'
  )

  if (!container) {
    generatingPhotoBooks = false
    return
  }

  if (button) button.disabled = true

  container.replaceChildren()

  const heading = document.createElement('p')
  container.appendChild(heading)

  let succeeded = 0
  let failed = 0

  try {
    for (const team of [...teams]) {
      heading.textContent =
        `Fotoboekje verwerken: ${team.team_name}`

      try {
        await saveTeamPhotoBook(team)
        succeeded++
      } catch (error) {
        failed++

        console.error(error)

        const line = document.createElement('p')

        line.style.color = '#a12626'

        line.textContent =
          `❌ ${team.team_name}: ` +
          (error.message || 'Onbekende fout')

        container.appendChild(line)
      }
    }

    // Wacht tot we niet meer bezig zijn
    // voor de normale dashboardverversing.

  } finally {
    generatingPhotoBooks = false

    const success = await loadDashboardData()

    if (success) {
      renderDashboard()

      setMessage(
        'dashboardMessage',
        `${succeeded} fotoboekje(s) verwerkt, ` +
        `${failed} fout(en).`,
        failed > 0
      )
    }

    if (button?.isConnected) {
      button.disabled = false
    }
  }
}

// ==========================================
// SPEL BEËINDIGEN
// ==========================================

async function archiveCurrentSession() {
  if (
    isBusy() ||
    !activeSession ||
    !teams.length
  ) {
    return
  }

  const completedBooks = teams.filter(
    team => savedPhotoBooks.some(
      book =>
        book.team_id === team.id &&
        book.storage_path === pdfPath(team)
    )
  ).length

  if (completedBooks !== teams.length) {
    alert(
      'Maak eerst alle ontbrekende fotoboekjes.'
    )
    return
  }

  const confirmed = confirm(
    'Wil je dit spel beëindigen?\n\n' +
    `Teams: ${teams.length}\n` +
    `Fotoboekjes: ${completedBooks}\n\n` +
    'Alle oude gegevens blijven bewaard. ' +
    'Er start een nieuwe, lege spelronde.'
  )

  if (!confirmed) return

  const finalConfirmation = confirm(
    'Laatste controle:\n\n' +
    'Zijn alle teams klaar en zijn de ' +
    'opgeslagen fotoboekjes definitief?\n\n' +
    'Klik op OK om het spel af te sluiten.'
  )

  if (!finalConfirmation) return

  archivingSession = true

  const button = document.getElementById(
    'archiveSessionButton'
  )

  if (button) {
    button.disabled = true
    button.textContent = 'Spel afsluiten...'
  }

  setMessage(
    'archiveMessage',
    'Fotoboekjes controleren en spel afsluiten...'
  )

  let succeeded = false

  try {
    const { error } = await supabase.rpc(
      'archive_big_five_session',
      {
        p_session_id: activeSession.id
      }
    )

    if (error) throw error

    succeeded = true

    alert(
      '✅ Spel beëindigd!\n\n' +
      'Alle fotoboekjes blijven in Supabase.\n' +
      'Er is een nieuwe, lege spelronde gestart.'
    )

  } catch (error) {
    console.error(error)

    setMessage(
      'archiveMessage',
      'Afsluiten mislukt: ' +
      (error.message || 'Onbekende fout'),
      true
    )

  } finally {
    archivingSession = false
  }

  if (succeeded) {
    await startDashboard()
  } else if (button?.isConnected) {
    button.disabled = false
    button.textContent =
      '🏁 Spel beëindigen en nieuw spel starten'
  }
}

// ==========================================
// KNOPPEN KOPPELEN
// ==========================================

function bindDashboardEvents() {
  document
    .getElementById('logoutButton')
    ?.addEventListener('click', async () => {
      if (isBusy()) return

      stopRefreshing()

      await supabase.auth.signOut()

      renderLogin()
    })

  document
    .getElementById('refreshButton')
    ?.addEventListener('click', () => {
      refreshDashboard()
    })

  document
    .querySelectorAll('.openTeamButton')
    .forEach(button => {
      button.addEventListener('click', () => {
        if (isBusy()) return

        const id = button.dataset.teamId

        selectedTeamId =
          selectedTeamId === id
            ? null
            : id

        renderDashboard()
      })
    })

  document
    .getElementById('closeTeamButton')
    ?.addEventListener('click', () => {
      selectedTeamId = null
      renderDashboard()
    })

  document
    .getElementById('showQuizAnswers')
    ?.addEventListener('click', event => {
      showQuizAnswers(
        event.currentTarget.dataset.submissionId
      )
    })

  document
    .querySelectorAll('.viewPhotoButton')
    .forEach(button => {
      button.addEventListener('click', () => {
        viewPhoto(button.dataset.photoId)
      })
    })

  document
    .querySelectorAll('.approvePhotoButton')
    .forEach(button => {
      button.addEventListener('click', () => {
        reviewPhoto(
          button.dataset.photoId,
          'approved'
        )
      })
    })

  document
    .querySelectorAll('.rejectPhotoButton')
    .forEach(button => {
      button.addEventListener('click', () => {
        reviewPhoto(
          button.dataset.photoId,
          'rejected'
        )
      })
    })

  document
    .querySelectorAll('.saveActivityButton')
    .forEach(button => {
      button.addEventListener('click', () => {
        saveActivityScore(
          button.dataset.teamId,
          button.dataset.activity
        )
      })
    })

  document
    .getElementById('generatePhotoBooksButton')
    ?.addEventListener('click', () => {
      generateAllPhotoBooks()
    })

  document
    .getElementById('archiveSessionButton')
    ?.addEventListener('click', () => {
      archiveCurrentSession()
    })
}

// ==========================================
// DASHBOARD STARTEN
// ==========================================

checkInstructor()
