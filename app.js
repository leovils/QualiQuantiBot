// Application state variables
// Initialize Supabase Client
let supabaseClient = null;
if (typeof supabase !== 'undefined' && supabase.createClient) {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.error("Supabase SDK not loaded or config missing.");
}

let sessionId = "";
let questions = [];
let currentQuestionIndex = 0;
let currentInputMode = "audio"; // 'audio' or 'text'

// Audio recorder state variables
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingDuration = 0;
let recordedBlob = null;

// Initial setup
document.addEventListener("DOMContentLoaded", () => {
    // Generate/retrieve session ID
    sessionId = sessionStorage.getItem("survey_session_id");
    if (!sessionId) {
        sessionId = "sess_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now().toString().slice(-6);
        sessionStorage.setItem("survey_session_id", sessionId);
    }
    
    // Bind main buttons
    document.getElementById("start-btn").addEventListener("click", showInstructions);
    document.getElementById("instructions-ok-btn").addEventListener("click", startSurvey);
    document.getElementById("restart-btn").addEventListener("click", restartSurvey);
    
    // Bind audio recorder actions
    document.getElementById("record-btn").addEventListener("click", startRecording);
    document.getElementById("stop-btn").addEventListener("click", stopRecording);
    document.getElementById("delete-audio-btn").addEventListener("click", deleteAudioRecording);
    document.getElementById("submit-audio-btn").addEventListener("click", submitAudioResponse);
    
    // Bind text response actions
    document.getElementById("submit-text-btn").addEventListener("click", submitTextResponse);
    
    // Fetch survey structure from API
    loadSurvey();
});

// Load the survey script from FastAPI
async function loadSurvey() {
    try {
        const response = await fetch("survey_script.json");
        if (!response.ok) throw new Error("Não foi possível carregar as perguntas.");
        questions = await response.json();
    } catch (error) {
        console.error("Erro ao carregar roteiro:", error);
        document.getElementById("question-text").innerText = "Erro ao carregar a pesquisa.";
    }
}

// Show instructions screen
function showInstructions() {
    if (questions.length === 0) {
        alert("A pesquisa ainda não foi carregada. Por favor, aguarde.");
        return;
    }
    document.getElementById("welcome-screen").classList.remove("active");
    setTimeout(() => {
        document.getElementById("instructions-screen").classList.add("active");
    }, 200);
}

// Start the survey flow
function startSurvey() {
    document.getElementById("instructions-screen").classList.remove("active");
    setTimeout(() => {
        document.getElementById("question-screen").classList.add("active");
        renderQuestion();
    }, 200);
}

// Restart survey
function restartSurvey() {
    // Generate new session ID
    sessionId = "sess_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now().toString().slice(-6);
    sessionStorage.setItem("survey_session_id", sessionId);
    
    currentQuestionIndex = 0;
    document.getElementById("completed-screen").classList.remove("active");
    setTimeout(() => {
        document.getElementById("question-screen").classList.add("active");
        renderQuestion();
    }, 200);
}

// Render the current question based on its index
function renderQuestion() {
    if (currentQuestionIndex >= questions.length) {
        showCompletedScreen();
        return;
    }
    
    const question = questions[currentQuestionIndex];
    
    // Update progress bar
    const progressPercent = Math.round((currentQuestionIndex / questions.length) * 100);
    document.getElementById("progress-fill").style.width = `${progressPercent}%`;
    document.getElementById("progress-percent").innerText = `${progressPercent}%`;
    document.getElementById("question-index-label").innerText = `Pergunta ${currentQuestionIndex + 1} de ${questions.length}`;
    
    // Update question text
    document.getElementById("question-text").innerText = question.question;
    
    // Reset inputs
    resetInputs();
    
    // Handle question view types
    if (question.type === "choice") {
        document.getElementById("audio-text-view").classList.add("hide");
        document.getElementById("choice-view").classList.remove("hide");
        renderOptions(question.options);
    } else {
        document.getElementById("choice-view").classList.add("hide");
        document.getElementById("audio-text-view").classList.remove("hide");
        switchInputMode("audio"); // default to audio view
    }
}

// Render choice options (Quantitative survey)
function renderOptions(options) {
    const container = document.getElementById("options-list");
    container.innerHTML = "";
    
    options.forEach(option => {
        const button = document.createElement("button");
        button.className = "option-btn";
        
        // Inner content with standard check circle indicator
        button.innerHTML = `
            <span>${option}</span>
            <div class="option-indicator"><i class="fa-solid fa-check hide"></i></div>
        `;
        
        button.onclick = async () => {
            // Select visually
            button.classList.add("selected");
            const indicatorIcon = button.querySelector(".option-indicator i");
            indicatorIcon.classList.remove("hide");
            
            // Short delay for satisfying UI transition
            setTimeout(async () => {
                await submitResponse("choice", option);
            }, 500);
        };
        
        container.appendChild(button);
    });
}

// Switch between voice and text input modes
function switchInputMode(mode) {
    currentInputMode = mode;
    
    const tabAudio = document.getElementById("tab-audio");
    const tabText = document.getElementById("tab-text");
    const containerAudio = document.getElementById("input-audio-container");
    const containerText = document.getElementById("input-text-container");
    
    if (mode === "audio") {
        tabAudio.classList.add("active");
        tabText.classList.remove("active");
        containerAudio.classList.add("active");
        containerText.classList.remove("active");
    } else {
        tabText.classList.add("active");
        tabAudio.classList.remove("active");
        containerText.classList.add("active");
        containerAudio.classList.remove("active");
        
        // Cancel recording if it was running
        if (mediaRecorder && mediaRecorder.state === "recording") {
            stopRecording();
            deleteAudioRecording();
        }
    }
}

// Reset all input fields/audio states
function resetInputs() {
    // Reset text field
    document.getElementById("text-response-input").value = "";
    
    // Reset text button state
    const submitTextBtn = document.getElementById("submit-text-btn");
    submitTextBtn.disabled = false;
    submitTextBtn.innerHTML = `Enviar Resposta Escrita <i class="fa-solid fa-paper-plane"></i>`;
    
    // Reset audio state variables
    deleteAudioRecording();
}

// Audio Recording Logic
async function startRecording() {
    audioChunks = [];
    recordedBlob = null;
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Seu navegador não oferece suporte para gravação de áudio. Por favor, responda digitando.");
        switchInputMode("text");
        return;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            recordedBlob = new Blob(audioChunks, { type: "audio/webm" });
            const audioUrl = URL.createObjectURL(recordedBlob);
            
            // Setup preview audio element
            const previewPlayer = document.getElementById("audio-preview");
            previewPlayer.src = audioUrl;
            
            // Update visual states
            document.getElementById("recording-wave").classList.add("hide");
            document.getElementById("recording-status").innerText = "Gravação concluída! Ouça ou refaça abaixo.";
            document.getElementById("audio-preview-container").classList.remove("hide");
            document.getElementById("submit-audio-btn").classList.remove("hide");
            
            // Clean up microphone stream tracks
            stream.getTracks().forEach(track => track.stop());
        };
        
        // Start recording
        mediaRecorder.start();
        
        // Timer UI initialization
        recordingDuration = 0;
        document.getElementById("recording-timer").innerText = "00:00";
        document.getElementById("recording-status").innerText = "Gravando...";
        document.getElementById("recording-wave").classList.remove("hide");
        document.getElementById("record-btn").classList.add("hide");
        document.getElementById("stop-btn").classList.remove("hide");
        
        recordingInterval = setInterval(() => {
            recordingDuration++;
            const minutes = Math.floor(recordingDuration / 60).toString().padStart(2, "0");
            const seconds = (recordingDuration % 60).toString().padStart(2, "0");
            document.getElementById("recording-timer").innerText = `${minutes}:${seconds}`;
        }, 1000);
        
    } catch (error) {
        console.error("Erro ao obter acesso ao microfone:", error);
        alert("Permissão de microfone negada. Por favor, conceda permissão ou utilize a resposta por escrito.");
        switchInputMode("text");
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        
        // Clear interval
        clearInterval(recordingInterval);
        
        // Reset controls
        document.getElementById("stop-btn").classList.add("hide");
        document.getElementById("record-btn").classList.remove("hide");
    }
}

function deleteAudioRecording() {
    // Clear audio chunks
    audioChunks = [];
    recordedBlob = null;
    
    // Stop recording timer
    clearInterval(recordingInterval);
    recordingDuration = 0;
    
    // Reset HTML audio preview
    const previewPlayer = document.getElementById("audio-preview");
    previewPlayer.src = "";
    
    // Reset UI visibility
    document.getElementById("recording-timer").innerText = "00:00";
    document.getElementById("recording-status").innerText = "Pronto para gravar";
    document.getElementById("recording-wave").classList.add("hide");
    document.getElementById("audio-preview-container").classList.add("hide");
    
    // Reset audio button state
    const submitAudioBtn = document.getElementById("submit-audio-btn");
    submitAudioBtn.disabled = false;
    submitAudioBtn.innerHTML = `Enviar Áudio <i class="fa-solid fa-paper-plane"></i>`;
    submitAudioBtn.classList.add("hide");
    
    document.getElementById("record-btn").classList.remove("hide");
    document.getElementById("stop-btn").classList.add("hide");
}

// Submission logic
async function submitAudioResponse() {
    if (!recordedBlob) return;
    
    document.getElementById("submit-audio-btn").disabled = true;
    document.getElementById("submit-audio-btn").innerHTML = `Enviando... <i class="fa-solid fa-spinner fa-spin"></i>`;
    
    try {
        await uploadResponse("audio", null, recordedBlob);
        currentQuestionIndex++;
        renderQuestion();
    } catch (err) {
        alert("Falha ao enviar áudio. Tente novamente.");
        document.getElementById("submit-audio-btn").disabled = false;
        document.getElementById("submit-audio-btn").innerHTML = `Enviar Áudio <i class="fa-solid fa-paper-plane"></i>`;
    }
}

async function submitTextResponse() {
    const textVal = document.getElementById("text-response-input").value.trim();
    if (!textVal) {
        alert("Por favor, digite uma resposta antes de enviar.");
        return;
    }
    
    document.getElementById("submit-text-btn").disabled = true;
    document.getElementById("submit-text-btn").innerHTML = `Enviando... <i class="fa-solid fa-spinner fa-spin"></i>`;
    
    try {
        await uploadResponse("text", textVal, null);
        currentQuestionIndex++;
        renderQuestion();
    } catch (err) {
        alert("Falha ao enviar resposta escrita. Tente novamente.");
        document.getElementById("submit-text-btn").disabled = false;
        document.getElementById("submit-text-btn").innerHTML = `Enviar Resposta Escrita <i class="fa-solid fa-paper-plane"></i>`;
    }
}

async function submitResponse(type, value) {
    try {
        await uploadResponse(type, value, null);
        currentQuestionIndex++;
        renderQuestion();
    } catch (err) {
        alert("Falha ao enviar seleção. Tente novamente.");
    }
}

// Upload function wrapper
async function uploadResponse(type, textValue, audioBlob) {
    if (!supabaseClient) {
        throw new Error("Supabase não está configurado.");
    }
    
    const currentQuestion = questions[currentQuestionIndex];
    let audioPath = null;

    // Se houver gravação de áudio, enviar para o Supabase Storage Bucket
    if (audioBlob) {
        const uniqueId = Math.random().toString(36).substring(2, 7);
        const fileExt = ".webm"; // Extensão padrão
        const audioFilename = `${sessionId}_${currentQuestion.id}_${uniqueId}${fileExt}`;
        
        const { data, error } = await supabaseClient.storage
            .from('audio-responses')
            .upload(audioFilename, audioBlob, {
                contentType: 'audio/webm',
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error("Erro no upload do áudio para o Storage:", error);
            throw error;
        }
        audioPath = audioFilename; // Guarda a referência do caminho no Storage
    }

    // Inserir registro na tabela responses
    const { data, error } = await supabaseClient
        .from('responses')
        .insert([
            {
                session_id: sessionId,
                question_id: currentQuestion.id,
                response_type: type,
                text_response: textValue,
                audio_path: audioPath
            }
        ]);

    if (error) {
        console.error("Erro ao salvar dados no Banco de Dados Supabase:", error);
        throw error;
    }

    return { status: "success" };
}

// Completion screen transition
function showCompletedScreen() {
    // Fill the progress bar completely
    document.getElementById("progress-fill").style.width = `100%`;
    document.getElementById("progress-percent").innerText = `100%`;
    
    // Switch active screens
    document.getElementById("question-screen").classList.remove("active");
    setTimeout(() => {
        document.getElementById("completed-screen").classList.add("active");
    }, 200);
}
