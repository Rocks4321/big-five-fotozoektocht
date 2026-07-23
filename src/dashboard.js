import './style.css'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

document.querySelector('#app').innerHTML = `
  <div class="quiz-logo">
    <img
      src="${import.meta.env.BASE_URL}logo-rnr.png"
      alt="Rocks 'n Rivers logo"
    />
  </div>

  <div class="dashboard-page">
    <h1>Instructeur Dashboard</h1>

    <button type="button" id="resetButton">
      Reset alle inzendingen
    </button>

    <div id="stats">Laden van statistieken...</div>

    <div id="dashboardTable">Laden...</div>

    <div id="submissionDetails" hidden></div>

    <div id="quizOverview">Vragen laden...</div>
  </div>
`

const dashboardTableDiv = document.querySelector('#dashboardTable')
const statsDiv = document.querySelector('#stats')
const resetButton = document.querySelector('#resetButton')
const quizOverviewDiv = document.querySelector('#quizOverview')
const submissionDetailsDiv = document.querySelector('#submissionDetails')

let allSubmissions = []
let activeSubmissionId = null
let detailsRequestNumber = 0

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDuration(seconds) {
  const totalSeconds = Number(seconds) || 0
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds
  ).padStart(2, '0')}`
}

function formatSubmittedAt(value) {
  if (!value) return '-'

  return new Date(value).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getRank(data, index) {
  if (index === 0) return 1

  const currentScore = Number(data[index].correct_count) || 0
  const previousScore = Number(data[index - 1].correct_count) || 0

  if (currentScore === previousScore) {
    return getRank(data, index - 1)
  }

  return index + 1
}

function renderStats(data) {
  const totalTeams = data.length

  const totalCorrect = data.reduce(
    (sum, row) => sum + (Number(row.correct_count) || 0),
    0
  )

  const averageScore =
    totalTeams > 0 ? (totalCorrect / totalTeams).toFixed(2) : '0.00'

  const bestScore =
    totalTeams > 0
      ? Math.max(...data.map((row) => Number(row.correct_count) || 0))
      : 0

  statsDiv.innerHTML = `
    <div style="display:flex; gap:20px; flex-wrap:wrap; margin:20px 0;">
      <div>
        <strong>Aantal teams:</strong>
        ${totalTeams}
      </div>

      <div>
        <strong>Gemiddelde score:</strong>
        ${averageScore}
      </div>

      <div>
        <strong>Hoogste score:</strong>
        ${bestScore}
      </div>
    </div>
  `
}

function renderTable(data) {
  if (!data || data.length === 0) {
    dashboardTableDiv.innerHTML = '<p>Geen inzendingen gevonden.</p>'
    closeSubmissionDetails()
    return
  }

  let html = `
    <h2>Klassement</h2>

    <table
      border="1"
      style="width:100%; border-collapse:collapse;"
    >
      <thead>
        <tr>
          <th>Plaats</th>
          <th>Team</th>
          <th>Goed</th>
          <th>Fout</th>
          <th>Tijd</th>
          <th>Ingeleverd</th>
          <th>Details</th>
        </tr>
      </thead>

      <tbody>
  `

  data.forEach((row, index) => {
    const rank = getRank(data, index)

    let medal = ''

    if (rank === 1) medal = '🥇'
    if (rank === 2) medal = '🥈'
    if (rank === 3) medal = '🥉'

    const isOpen =
      activeSubmissionId !== null &&
      String(activeSubmissionId) === String(row.id)

    html += `
      <tr>
        <td>${medal} ${rank}</td>

        <td>
          ${escapeHtml(row.team_name || 'Onbekend')}
        </td>

        <td>
          ${Number(row.correct_count) || 0}
        </td>

        <td>
          ${Number(row.incorrect_count) || 0}
        </td>

        <td>
          ${formatDuration(row.duration_seconds)}
        </td>

        <td>
          ${formatSubmittedAt(row.submitted_at)}
        </td>

        <td>
          <button
            type="button"
            class="submission-detail-button"
            data-submission-id="${row.id}"
          >
            ${isOpen ? 'Sluiten' : 'Bekijk'}
          </button>
        </td>
      </tr>
    `
  })

  html += `
      </tbody>
    </table>
  `

  dashboardTableDiv.innerHTML = html
}

async function loadDashboard() {
  try {
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .order('correct_count', { ascending: false })
      .order('submitted_at', { ascending: true })

    if (error) {
      console.error('Fout bij ophalen dashboard:', error)

      dashboardTableDiv.innerHTML =
        '<p>Fout bij laden van het dashboard.</p>'

      statsDiv.innerHTML = ''
      return
    }

    allSubmissions = data || []

    if (activeSubmissionId !== null) {
      const activeSubmissionStillExists = allSubmissions.some(
        (submission) =>
          String(submission.id) === String(activeSubmissionId)
      )

      if (!activeSubmissionStillExists) {
        closeSubmissionDetails()
      }
    }

    renderStats(allSubmissions)
    renderTable(allSubmissions)
  } catch (error) {
    console.error(
      'Onverwachte fout bij laden dashboard:',
      error
    )

    dashboardTableDiv.innerHTML =
      '<p>Er ging iets mis bij het laden van het dashboard.</p>'
  }
}

function closeSubmissionDetails() {
  activeSubmissionId = null

  /*
   * Hiermee worden eventueel nog lopende aanvragen ongeldig.
   * Een oude aanvraag kan de gesloten details daardoor niet opnieuw openen.
   */
  detailsRequestNumber += 1

  submissionDetailsDiv.innerHTML = ''
  submissionDetailsDiv.hidden = true

  if (allSubmissions.length > 0) {
    renderTable(allSubmissions)
  }
}

async function loadSubmissionDetails(submissionId) {
  const requestedSubmissionId = String(submissionId)

  if (
    activeSubmissionId !== null &&
    String(activeSubmissionId) === requestedSubmissionId
  ) {
    closeSubmissionDetails()
    return
  }

  activeSubmissionId = requestedSubmissionId

  const currentRequestNumber = ++detailsRequestNumber

  renderTable(allSubmissions)

  submissionDetailsDiv.hidden = false
  submissionDetailsDiv.innerHTML =
    '<p>Teamantwoorden laden...</p>'

  const submission = allSubmissions.find(
    (row) => String(row.id) === requestedSubmissionId
  )

  const { data, error } = await supabase
    .from('submission_answers')
    .select(`
      id,
      selected_answer,
      is_correct,
      question_id,
      questions (
        question_number,
        question_text,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_answer,
        explanation
      )
    `)
    .eq('submission_id', requestedSubmissionId)

  /*
   * Stop wanneer ondertussen een ander team is geopend
   * of wanneer de details zijn gesloten.
   */
  if (
    currentRequestNumber !== detailsRequestNumber ||
    activeSubmissionId === null ||
    String(activeSubmissionId) !== requestedSubmissionId
  ) {
    return
  }

  if (error) {
    console.error('Fout bij ophalen teamantwoorden:', error)

    submissionDetailsDiv.innerHTML = `
      <div class="quiz-detail-card">
        <p>Fout bij ophalen van de teamantwoorden.</p>

        <button
          type="button"
          class="close-submission-details"
        >
          Antwoorden sluiten
        </button>
      </div>
    `

    return
  }

  const answers = [...(data || [])].sort(
    (a, b) =>
      Number(a.questions?.question_number || 0) -
      Number(b.questions?.question_number || 0)
  )

  if (answers.length === 0) {
    submissionDetailsDiv.innerHTML = `
      <div class="quiz-detail-card">
        <h2>
          Antwoorden van
          ${escapeHtml(submission?.team_name || 'Onbekend team')}
        </h2>

        <p>Voor dit team zijn geen antwoorden gevonden.</p>

        <button
          type="button"
          class="close-submission-details"
        >
          Antwoorden sluiten
        </button>
      </div>
    `

    return
  }

  let html = `
    <div class="quiz-detail-card">
      <div class="submission-details-header">
        <h2>
          Antwoorden van
          ${escapeHtml(submission?.team_name || 'Onbekend team')}
        </h2>

        <button
          type="button"
          class="close-submission-details"
        >
          Antwoorden sluiten
        </button>
      </div>
  `

  answers.forEach((answer) => {
    const question = answer.questions || {}
    const resultText = answer.is_correct ? '✅ Goed' : '❌ Fout'

    html += `
      <div class="dashboard-question">
        <p>
          <strong>
            ${question.question_number || '-'}.
            ${escapeHtml(question.question_text || '')}
          </strong>
        </p>

        <p>
          <strong>Antwoord team:</strong>
          ${escapeHtml(answer.selected_answer || 'Niet ingevuld')}
        </p>

        <p>
          <strong>Juiste antwoord:</strong>
          ${escapeHtml(question.correct_answer || '-')}
        </p>

        <p>
          <strong>Resultaat:</strong>
          ${resultText}
        </p>

        ${
          question.explanation
            ? `
              <p>
                <strong>Uitleg:</strong>
                ${escapeHtml(question.explanation)}
              </p>
            `
            : ''
        }
      </div>
    `
  })

  html += `
    </div>
  `

  submissionDetailsDiv.innerHTML = html
  submissionDetailsDiv.hidden = false

  submissionDetailsDiv.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

async function loadAnswerModel() {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .order('question_number', { ascending: true })

  if (error) {
    console.error('Fout bij ophalen vragen:', error)

    quizOverviewDiv.innerHTML =
      '<p>Fout bij ophalen van het antwoordmodel.</p>'

    return
  }

  if (!data || data.length === 0) {
    quizOverviewDiv.innerHTML =
      '<p>Er zijn nog geen quizvragen ingevoerd.</p>'

    return
  }

  let html = `
    <div class="quiz-overview-section">
      <h2>Vragen en antwoordmodel</h2>
  `

  data.forEach((question) => {
    html += `
      <div class="dashboard-question">
        <p>
          <strong>
            ${question.question_number}.
            ${escapeHtml(question.question_text)}
          </strong>
        </p>

        <ul>
          <li>
            <strong>A:</strong>
            ${escapeHtml(question.option_a)}
          </li>

          <li>
            <strong>B:</strong>
            ${escapeHtml(question.option_b)}
          </li>

          ${
            question.option_c
              ? `
                <li>
                  <strong>C:</strong>
                  ${escapeHtml(question.option_c)}
                </li>
              `
              : ''
          }

          ${
            question.option_d
              ? `
                <li>
                  <strong>D:</strong>
                  ${escapeHtml(question.option_d)}
                </li>
              `
              : ''
          }
        </ul>

        <p>
          <strong>Juiste antwoord:</strong>
          ${escapeHtml(question.correct_answer)}
        </p>

        ${
          question.explanation
            ? `
              <p>
                <strong>Uitleg:</strong>
                ${escapeHtml(question.explanation)}
              </p>
            `
            : ''
        }
      </div>
    `
  })

  html += `
    </div>
  `

  quizOverviewDiv.innerHTML = html
}

async function resetSubmissions() {
  const confirmed = window.confirm(
    'Weet je zeker dat je alle inzendingen wilt verwijderen? De quizvragen blijven behouden.'
  )

  if (!confirmed) return

  resetButton.disabled = true
  resetButton.textContent = 'Bezig met resetten...'

  try {
    const { error: answersError } = await supabase
      .from('submission_answers')
      .delete()
      .not('id', 'is', null)

    if (answersError) {
      console.error('Reset antwoorden fout:', answersError)
      alert('Verwijderen van antwoorden is mislukt.')
      return
    }

    const { error: submissionsError } = await supabase
      .from('submissions')
      .delete()
      .not('id', 'is', null)

    if (submissionsError) {
      console.error('Reset inzendingen fout:', submissionsError)
      alert('Verwijderen van inzendingen is mislukt.')
      return
    }

    closeSubmissionDetails()

    alert('Alle inzendingen zijn verwijderd.')

    await loadDashboard()
  } finally {
    resetButton.disabled = false
    resetButton.textContent = 'Reset alle inzendingen'
  }
}

/*
 * Eén centrale kliklistener voor alle knoppen.
 * Deze blijft ook werken nadat delen van de pagina opnieuw zijn getekend.
 */
document.addEventListener('click', (event) => {
  const detailButton = event.target.closest(
    '.submission-detail-button'
  )

  if (detailButton) {
    loadSubmissionDetails(
      detailButton.dataset.submissionId
    )

    return
  }

  const closeButton = event.target.closest(
    '.close-submission-details'
  )

  if (closeButton) {
    closeSubmissionDetails()
  }
})

resetButton.addEventListener('click', resetSubmissions)

loadDashboard()
loadAnswerModel()

supabase
  .channel('dashboard-realtime')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'submissions',
    },
    () => {
      loadDashboard()
    }
  )
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'submission_answers',
    },
    () => {
      loadDashboard()
    }
  )
  .subscribe()