import './style.css'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const app = document.querySelector('#app')

let teamName = ''
let questions = []
let answers = {}
let startedAt = null

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

function compareTeamNames(value) {
  return normalizeTeamName(value).toLocaleLowerCase('nl-NL')
}

function isDuplicateConstraintError(error) {
  return error?.code === '23505'
}

function showStartScreen() {
  teamName = ''
  questions = []
  answers = {}
  startedAt = null

  app.innerHTML = `
    <div class="quiz-logo">
      <img
        src="${import.meta.env.BASE_URL}logo-rnr.png"
        alt="Rocks 'n Rivers logo"
      />
    </div>

    <main class="quiz-page">
      <section class="quiz-card start-card">
        <h1>Big Five Fotozoektocht</h1>

        <p>Vul jullie teamnaam in en start de quiz.</p>

        <form id="teamForm">
          <label for="teamName">
            <strong>Teamnaam</strong>
          </label>

          <input
            id="teamName"
            name="teamName"
            type="text"
            maxlength="60"
            autocomplete="off"
            placeholder="Bijvoorbeeld: Team Leeuw"
            required
          />

          <button type="submit" id="startButton">
            Start quiz
          </button>
        </form>

        <p id="startError" class="error-message"></p>
      </section>
    </main>
  `

  const teamForm = document.querySelector('#teamForm')
  const teamNameInput = document.querySelector('#teamName')
  const startButton = document.querySelector('#startButton')
  const startError = document.querySelector('#startError')

  teamNameInput.focus()

  teamForm.addEventListener('submit', async (event) => {
    event.preventDefault()

    const enteredName = normalizeTeamName(teamNameInput.value)

    if (!enteredName) {
      startError.textContent = 'Vul eerst een teamnaam in.'
      teamNameInput.focus()
      return
    }

    teamNameInput.value = enteredName
    startError.textContent = ''
    startButton.disabled = true
    startButton.textContent = 'Teamnaam controleren...'

    const nameIsAlreadyUsed = await teamNameAlreadyExists(enteredName)

    if (nameIsAlreadyUsed === null) {
      startError.textContent =
        'De teamnaam kon niet worden gecontroleerd. Probeer het opnieuw.'

      startButton.disabled = false
      startButton.textContent = 'Start quiz'
      return
    }

    if (nameIsAlreadyUsed) {
      startError.textContent =
        `Teamnaam "${enteredName}" heeft de quiz al ingevuld. ` +
        'Kies een andere teamnaam.'

      startButton.disabled = false
      startButton.textContent = 'Start quiz'

      teamNameInput.focus()
      teamNameInput.select()
      return
    }

    teamName = enteredName
    startButton.textContent = 'Quiz laden...'

    await loadQuestions()
  })
}

async function teamNameAlreadyExists(enteredName) {
  const { data, error } = await supabase
    .from('submissions')
    .select('team_name')

  if (error) {
    console.error('Fout bij controleren teamnaam:', error)
    return null
  }

  const normalizedEnteredName = compareTeamNames(enteredName)

  return (data ?? []).some(
    (submission) =>
      compareTeamNames(submission.team_name) === normalizedEnteredName
  )
}

async function loadQuestions() {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .order('question_number', { ascending: true })

  if (error) {
    console.error('Fout bij laden vragen:', error)
    showLoadError('De quiz kon niet worden geladen.')
    return
  }

  if (!data || data.length === 0) {
    showLoadError('Er zijn nog geen quizvragen ingevoerd.')
    return
  }

  questions = data
  answers = {}
  startedAt = new Date()

  renderQuiz()
}

function showLoadError(message) {
  app.innerHTML = `
    <div class="quiz-logo">
      <img
        src="${import.meta.env.BASE_URL}logo-rnr.png"
        alt="Rocks 'n Rivers logo"
      />
    </div>

    <main class="quiz-page">
      <section class="quiz-card">
        <h1>Quiz niet beschikbaar</h1>
        <p>${escapeHtml(message)}</p>

        <button id="backButton">
          Terug
        </button>
      </section>
    </main>
  `

  document
    .querySelector('#backButton')
    .addEventListener('click', showStartScreen)
}

function showDuplicateTeamScreen() {
  app.innerHTML = `
    <div class="quiz-logo">
      <img
        src="${import.meta.env.BASE_URL}logo-rnr.png"
        alt="Rocks 'n Rivers logo"
      />
    </div>

    <main class="quiz-page">
      <section class="quiz-card start-card">
        <h1>Quiz al ingevuld</h1>

        <p>
          Teamnaam <strong>${escapeHtml(teamName)}</strong>
          heeft de quiz al ingevuld.
        </p>

        <p>
          Kies een andere teamnaam of neem contact op met de instructeur.
        </p>

        <button id="backToStartButton">
          Andere teamnaam kiezen
        </button>
      </section>
    </main>
  `

  document
    .querySelector('#backToStartButton')
    .addEventListener('click', showStartScreen)

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

function getOptions(question) {
  return [
    { letter: 'A', text: question.option_a },
    { letter: 'B', text: question.option_b },
    { letter: 'C', text: question.option_c },
    { letter: 'D', text: question.option_d },
  ].filter((option) => option.text)
}

function renderQuiz() {
  let questionsHtml = ''

  questions.forEach((question) => {
    const options = getOptions(question)

    const optionsHtml = options
      .map(
        (option) => `
          <label class="answer-option">
            <input
              type="radio"
              name="question-${question.id}"
              value="${option.letter}"
              data-question-id="${question.id}"
              ${answers[question.id] === option.letter ? 'checked' : ''}
            />

            <span class="answer-letter">${option.letter}</span>

            <span class="answer-text">
              ${escapeHtml(option.text)}
            </span>
          </label>
        `
      )
      .join('')

    questionsHtml += `
      <section class="quiz-card question-card" id="question-${question.id}">
        <h2>
          Vraag ${question.question_number}
        </h2>

        <p class="question-text">
          ${escapeHtml(question.question_text)}
        </p>

        <div class="answer-options">
          ${optionsHtml}
        </div>
      </section>
    `
  })

  app.innerHTML = `
    <div class="quiz-logo">
      <img
        src="${import.meta.env.BASE_URL}logo-rnr.png"
        alt="Rocks 'n Rivers logo"
      />
    </div>

    <main class="quiz-page">
      <section class="quiz-card quiz-header-card">
        <h1>Big Five Fotozoektocht</h1>
        <p><strong>Team:</strong> ${escapeHtml(teamName)}</p>
        <p>Beantwoord alle vragen en klik daarna op verzenden.</p>
      </section>

      <form id="quizForm">
        ${questionsHtml}

        <section class="quiz-card submit-card">
          <p id="quizError" class="error-message"></p>

          <button type="submit" id="submitQuizButton">
            Quiz verzenden
          </button>
        </section>
      </form>
    </main>
  `

  document.querySelectorAll('input[type="radio"]').forEach((input) => {
    input.addEventListener('change', () => {
      answers[input.dataset.questionId] = input.value
    })
  })

  document
    .querySelector('#quizForm')
    .addEventListener('submit', submitQuiz)
}

async function submitQuiz(event) {
  event.preventDefault()

  const quizError = document.querySelector('#quizError')
  const submitButton = document.querySelector('#submitQuizButton')

  const unansweredQuestions = questions.filter(
    (question) => !answers[question.id]
  )

  if (unansweredQuestions.length > 0) {
    quizError.textContent =
      unansweredQuestions.length === 1
        ? 'Beantwoord eerst de ontbrekende vraag.'
        : `Beantwoord eerst alle vragen. Er ontbreken nog ${unansweredQuestions.length} antwoorden.`

    const firstMissingQuestion = unansweredQuestions[0]

    document
      .querySelector(`#question-${firstMissingQuestion.id}`)
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })

    return
  }

  quizError.textContent = ''
  submitButton.disabled = true
  submitButton.textContent = 'Teamnaam controleren...'

  const nameIsAlreadyUsed = await teamNameAlreadyExists(teamName)

  if (nameIsAlreadyUsed === null) {
    quizError.textContent =
      'De teamnaam kon niet worden gecontroleerd. Probeer het opnieuw.'

    submitButton.disabled = false
    submitButton.textContent = 'Quiz verzenden'
    return
  }

  if (nameIsAlreadyUsed) {
    showDuplicateTeamScreen()
    return
  }

  submitButton.textContent = 'Bezig met verzenden...'

  const submittedAt = new Date()

  const durationSeconds = Math.max(
    0,
    Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000)
  )

  const answerResults = questions.map((question) => {
    const selectedAnswer = answers[question.id]
    const correctAnswer = String(question.correct_answer).toUpperCase()
    const isCorrect = selectedAnswer === correctAnswer

    return {
      question,
      selectedAnswer,
      correctAnswer,
      isCorrect,
    }
  })

  const correctCount = answerResults.filter(
    (answer) => answer.isCorrect
  ).length

  const incorrectCount = questions.length - correctCount

  const { data: submission, error: submissionError } = await supabase
    .from('submissions')
    .insert({
      team_name: teamName,
      started_at: startedAt.toISOString(),
      submitted_at: submittedAt.toISOString(),
      duration_seconds: durationSeconds,
      correct_count: correctCount,
      incorrect_count: incorrectCount,
    })
    .select('id')
    .single()

  if (submissionError) {
    console.error('Fout bij opslaan inzending:', submissionError)

    if (isDuplicateConstraintError(submissionError)) {
      showDuplicateTeamScreen()
      return
    }

    quizError.textContent =
      'De quiz kon niet worden opgeslagen. Probeer het opnieuw.'

    submitButton.disabled = false
    submitButton.textContent = 'Quiz verzenden'
    return
  }

  const answersToInsert = answerResults.map((answer) => ({
    submission_id: submission.id,
    question_id: answer.question.id,
    selected_answer: answer.selectedAnswer,
    is_correct: answer.isCorrect,
  }))

  const { error: answersError } = await supabase
    .from('submission_answers')
    .insert(answersToInsert)

  if (answersError) {
    console.error('Fout bij opslaan antwoorden:', answersError)

    await supabase
      .from('submissions')
      .delete()
      .eq('id', submission.id)

    quizError.textContent =
      'De antwoorden konden niet worden opgeslagen. Probeer het opnieuw.'

    submitButton.disabled = false
    submitButton.textContent = 'Quiz verzenden'
    return
  }

  renderResults(
    answerResults,
    correctCount,
    incorrectCount,
    durationSeconds
  )
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function getOptionText(question, letter) {
  const option = getOptions(question).find(
    (item) => item.letter === letter
  )

  return option?.text || '-'
}

function renderResults(
  answerResults,
  correctCount,
  incorrectCount,
  durationSeconds
) {
  const resultsHtml = answerResults
    .map((answer) => {
      const resultClass = answer.isCorrect
        ? 'result-correct'
        : 'result-incorrect'

      const resultLabel = answer.isCorrect ? '✅ Goed' : '❌ Fout'

      return `
        <section class="quiz-card result-card ${resultClass}">
          <h2>
            Vraag ${answer.question.question_number}: ${resultLabel}
          </h2>

          <p class="question-text">
            ${escapeHtml(answer.question.question_text)}
          </p>

          <p>
            <strong>Jullie antwoord:</strong>
            ${escapeHtml(answer.selectedAnswer)} –
            ${escapeHtml(
              getOptionText(
                answer.question,
                answer.selectedAnswer
              )
            )}
          </p>

          <p>
            <strong>Juiste antwoord:</strong>
            ${escapeHtml(answer.correctAnswer)} –
            ${escapeHtml(
              getOptionText(
                answer.question,
                answer.correctAnswer
              )
            )}
          </p>

          ${
            answer.question.explanation
              ? `
                <p>
                  <strong>Uitleg:</strong>
                  ${escapeHtml(answer.question.explanation)}
                </p>
              `
              : ''
          }
        </section>
      `
    })
    .join('')

  app.innerHTML = `
    <div class="quiz-logo">
      <img
        src="${import.meta.env.BASE_URL}logo-rnr.png"
        alt="Rocks 'n Rivers logo"
      />
    </div>

    <main class="quiz-page">
      <section class="quiz-card results-summary-card">
        <h1>Uitslag</h1>

        <p><strong>Team:</strong> ${escapeHtml(teamName)}</p>

        <div class="score-display">
          ${correctCount} van de ${questions.length} goed
        </div>

        <p>
          <strong>Fout:</strong> ${incorrectCount}
        </p>

        <p>
          <strong>Tijd:</strong> ${formatDuration(durationSeconds)}
        </p>
      </section>

      ${resultsHtml}

      <section class="quiz-card">
        <p>De antwoorden zijn verzonden.</p>
      </section>
    </main>
  `

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

showStartScreen()