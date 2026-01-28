const express = require('express');
const path = require('path');
 
const app = express();
app.use(express.json());
app.use(express.static('public'));
 
// Mock Database - Student Data
const mockDatabase = {
  'STU001': {
    student_id: 'STU001',
    profile_completed: false,
    tutorial_completed: false,
    documents_submitted: false,
    preferences_set: false,
    current_step: 'profile_setup',
    onboarding_started_at: '2024-01-15T10:00:00Z',
    onboarding_completed_at: null,
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    email: 'student001@example.com'
  },
  'STU002': {
    student_id: 'STU002',
    profile_completed: true,
    tutorial_completed: false,
    documents_submitted: false,
    preferences_set: false,
    current_step: 'tutorial',
    onboarding_started_at: '2024-01-10T08:00:00Z',
    onboarding_completed_at: null,
    created_at: '2024-01-10T08:00:00Z',
    updated_at: '2024-01-20T14:00:00Z',
    email: 'student002@example.com'
  },
  'STU003': {
    student_id: 'STU003',
    profile_completed: true,
    tutorial_completed: true,
    documents_submitted: true,
    preferences_set: true,
    current_step: 'completed',
    onboarding_started_at: '2024-01-05T09:00:00Z',
    onboarding_completed_at: '2024-01-06T15:00:00Z',
    created_at: '2024-01-05T09:00:00Z',
    updated_at: '2024-01-06T15:00:00Z',
    email: 'student003@example.com'
  }
};
 
// Store active chat sessions
const sessions = {};
 
// Serve marks.html as default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'marks.html'));
});
 
// Start chat session
app.post('/api/start-chat', async (req, res) => {
  const { studentId, providedMarks } = req.body;
  // Get student data (or create default if not found)
  const studentData = mockDatabase[studentId] || {
    student_id: studentId,
    profile_completed: false,
    tutorial_completed: false,
    documents_submitted: false,
    preferences_set: false,
    current_step: 'profile_setup',
    onboarding_started_at: new Date().toISOString(),
    onboarding_completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    email: null
  };
  // Initialize session
  sessions[studentId] = {
    studentData: studentData,
    providedMarks: providedMarks || {},
    collectedMarks: { ...providedMarks } || {},
    answers: {},
    currentQuestion: 0,
    questions: []
  };
  // Build question list
  const questions = buildQuestions(providedMarks || {});
  sessions[studentId].questions = questions;
  // Get first question
  if (questions.length > 0) {
    const firstQuestion = questions[0];
    const naturalQuestion = await makeQuestionNatural(firstQuestion.text);
    res.json({ message: naturalQuestion });
  } else {
    // No questions needed, go straight to prediction
    const prediction = predictDropout(studentData, providedMarks || {});
    const subjectAdvice = prediction.willDropout ? null : analyzeSubjects(providedMarks || {});
    const finalMessage = await generateFinalMessage(prediction, subjectAdvice);
    res.json({
      completed: true,
      prediction: prediction,
      subjectRecommendations: subjectAdvice,
      message: finalMessage
    });
  }
});
 
// Handle chat messages
app.post('/api/chat', async (req, res) => {
  const { studentId, message } = req.body;
  const session = sessions[studentId];
  if (!session) {
    return res.status(400).json({ error: 'Session not found' });
  }
  // Store conversation for AI analysis
  if (!session.conversationContext) {
    session.conversationContext = { messages: [] };
  }
  session.conversationContext.messages.push(`User: ${message}`);
  // Parse and store answer
  const currentQuestion = session.questions[session.currentQuestion];
  const answer = parseAnswer(message, currentQuestion);
  session.answers[currentQuestion.id] = answer;
  // Store marks if it's a score question
  if (currentQuestion.id.endsWith('_score') && answer !== null) {
    const subject = currentQuestion.id.replace('_score', '');
    session.collectedMarks[subject] = answer;
    // ✨ NEW: Check if AI follow-up needed
    const followUp = await checkForFollowUp(subject, answer, session.studentData);
    if (followUp) {
      session.conversationContext.messages.push(`Bot: ${followUp}`);
      return res.json({
        message: followUp,
        completed: false,
        isFollowUp: true
      });
    }
  }
  // Move to next question
  session.currentQuestion++;
  // Check if all questions answered
  if (session.currentQuestion >= session.questions.length) {
    // ✨ ENHANCED: Use AI-enhanced prediction
    const prediction = await predictDropout(
      session.studentData, 
      session.collectedMarks,
      session.conversationContext
    );
    const subjectAdvice = prediction.willDropout ? null : analyzeSubjects(session.collectedMarks);
    const finalMessage = await generateFinalMessage(prediction, subjectAdvice);
    return res.json({
      completed: true,
      prediction: prediction,
      subjectRecommendations: subjectAdvice,
      message: finalMessage
    });
  }
  // Ask next question
  const nextQuestion = session.questions[session.currentQuestion];
  const naturalQuestion = await makeQuestionNatural(nextQuestion.text);
  session.conversationContext.messages.push(`Bot: ${naturalQuestion}`);
  res.json({
    message: naturalQuestion,
    completed: false
  });
});
 
// After collecting a subject's marks, check if follow-up needed
async function checkForFollowUp(subject, score, studentData) {
  // Rule-based triggers for AI follow-up
  if (score < 35) {
    // Critical score - ask about support
    return await generateAIFollowUp({
      subject: subject,
      score: score,
      context: 'failing',
      prompt: `Student scored ${score}% in ${subject}. Ask ONE empathetic question about tutoring or support available.`
    });
  } else if (score < 50 && !studentData.tutorial_completed) {
    // Struggling + no tutorial
    return await generateAIFollowUp({
      subject: subject,
      score: score,
      context: 'struggling_no_support',
      prompt: `Student scored ${score}% in ${subject} and hasn't completed tutorial. Ask if they need help understanding the material.`
    });
  }
  return null; // No follow-up needed
}
 
async function generateAIFollowUp(context) {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.2:1b',
      messages: [{
        role: 'user',
        content: context.prompt + ' Keep it to ONE sentence, friendly and supportive.'
      }],
      stream: false
    })
  });
  const data = await response.json();
  let followUp = data.message.content;
  followUp = followUp.replace(/<\|start_header_id\|>.*?<\|end_header_id\|>/g, '').trim();
  return followUp;
}

async function predictDropout(studentData, marks, conversationContext) {
  // Phase A: Rule-based calculation (fast, reliable)
  const ruleBasedScore = calculateRiskScore(studentData, marks);
  // Phase B: AI analyzes conversation for hidden signals (smart)
  const aiInsights = await analyzeConversationWithAI(conversationContext);
  // Phase C: Combine both
  const finalPrediction = {
    riskScore: ruleBasedScore.score,
    riskLevel: ruleBasedScore.level,
    willDropout: ruleBasedScore.score >= 60,
    reasons: [...ruleBasedScore.reasons, ...aiInsights.additionalRisks],
    aiInsights: aiInsights.summary
  };
  return finalPrediction;
}
 
async function analyzeConversationWithAI(context) {
  const prompt = `Analyze this student conversation for dropout risk signals:
 
Conversation:
${context.messages.join('\n')}
 
Identify:
1. Emotional state (motivated/discouraged/neutral)
2. Support system (has help/isolated)
3. Engagement level (active/passive)
 
Return JSON:
{
  "emotionalState": "...",
  "hasSupport": true/false,
  "engagementLevel": "...",
  "additionalRisks": ["risk1", "risk2"],
  "summary": "brief analysis"
}`;
 
  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:1b',
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });
    const data = await response.json();
    let content = data.message.content;
    content = content.replace(/<\|start_header_id\|>.*?<\|end_header_id\|>/g, '').trim();
    // Try to parse JSON, fallback if fails
    try {
      return JSON.parse(content);
    } catch {
      return {
        emotionalState: 'neutral',
        hasSupport: false,
        engagementLevel: 'unknown',
        additionalRisks: [],
        summary: 'Unable to analyze conversation'
      };
    }
  } catch (error) {
    console.error('AI analysis error:', error);
    return {
      emotionalState: 'neutral',
      hasSupport: false,
      engagementLevel: 'unknown',
      additionalRisks: [],
      summary: 'Analysis unavailable'
    };
  }
}
 
function calculateRiskScore(studentData, marks) {
  // Your existing rule-based logic
  let score = 0;
  const reasons = [];
  // Onboarding factors
  if (!studentData.profile_completed) {
    score += 25;
    reasons.push("Profile not completed");
  }
  // Academic factors
  const avgMarks = calculateAverage(marks);
  if (avgMarks < 40) {
    score += 25;
    reasons.push(`Low average: ${avgMarks}%`);
  }
  // Time factors
  const daysSinceStart = getDaysSince(studentData.onboarding_started_at);
  if (daysSinceStart > 14) {
    score += 25;
    reasons.push(`${daysSinceStart} days since start`);
  }
  return {
    score: Math.min(score, 100),
    level: score >= 70 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW',
    reasons: reasons
  };
}

// Build question list (skip subjects with provided marks)
function buildQuestions(providedMarks) {
  const questions = [];
  const subjects = ['english', 'marathi', 'hindi', 'social_science', 'science', 'maths'];
  subjects.forEach(subject => {
    // Only ask if mark not provided
    if (providedMarks[subject] === undefined || providedMarks[subject] === null) {
      questions.push({
        id: `has_${subject}`,
        text: `Do you have marks for ${subject.replace('_', ' ')}? (yes/no)`,
        type: 'yesno'
      });
      questions.push({
        id: `${subject}_score`,
        text: `What is your ${subject.replace('_', ' ')} score? (0-100)`,
        type: 'number',
        condition: `has_${subject}`
      });
    }
  });
  return questions;
}
 
// Parse user answer
function parseAnswer(message, question) {
  const lower = message.toLowerCase().trim();
  // Yes/No questions
  if (question.type === 'yesno') {
    return lower.includes('yes') || lower === 'y';
  }
  // Number questions
  if (question.type === 'number') {
    const num = message.match(/\d+/);
    if (num && num[0] >= 0 && num[0] <= 100) {
      return parseInt(num[0]);
    }
    return null;
  }
  return message;
}
 
// Make question natural using Ollama
async function makeQuestionNatural(question) {
  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:1b',
        messages: [{
          role: 'user',  // Changed from 'system' to 'user'
          content: `Rephrase this question in a friendly, conversational way (1 sentence): "${question}"`
        }],
        stream: false
      })
    });
    const data = await response.json();
    // Clean up the response - remove special tokens
    let cleanMessage = data.message.content;
    cleanMessage = cleanMessage.replace(/<\|start_header_id\|>.*?<\|end_header_id\|>/g, '');
    cleanMessage = cleanMessage.replace(/\n+/g, ' ').trim();
    return cleanMessage || question; // Fallback to original if empty
  } catch (error) {
    console.error('Ollama error:', error);
    return question; // Fallback to original question if AI fails
  }
}

// Predict dropout
function predictDropout(studentData, marks) {
  let dropoutRisk = 0;
  const reasons = [];
  // Onboarding factors
  if (!studentData.profile_completed) {
    dropoutRisk += 25;
    reasons.push("Profile not completed");
  }
  if (!studentData.tutorial_completed) {
    dropoutRisk += 20;
    reasons.push("Tutorial not completed");
  }
  if (!studentData.documents_submitted) {
    dropoutRisk += 15;
    reasons.push("Documents not submitted");
  }
  if (!studentData.preferences_set) {
    dropoutRisk += 10;
    reasons.push("Preferences not set");
  }
  // Current step risk
  const stepRisk = {
    'profile_setup': 30,
    'tutorial': 20,
    'document_upload': 15,
    'preferences': 10,
    'completed': 0
  };
  const currentStepRisk = stepRisk[studentData.current_step] || 0;
  if (currentStepRisk > 0) {
    dropoutRisk += currentStepRisk;
    reasons.push(`Stuck at step: ${studentData.current_step}`);
  }
  // Time-based factors
  const daysSinceStart = getDaysSince(studentData.onboarding_started_at);
  if (daysSinceStart > 14) {
    dropoutRisk += 25;
    reasons.push(`${daysSinceStart} days since onboarding started`);
  } else if (daysSinceStart > 7) {
    dropoutRisk += 15;
    reasons.push(`${daysSinceStart} days in onboarding`);
  }
  const daysSinceUpdate = getDaysSince(studentData.updated_at);
  if (daysSinceUpdate > 7) {
    dropoutRisk += 20;
    reasons.push(`No activity for ${daysSinceUpdate} days`);
  } else if (daysSinceUpdate > 3) {
    dropoutRisk += 10;
    reasons.push(`Inactive for ${daysSinceUpdate} days`);
  }
  // Email validation
  if (!studentData.email || studentData.email === 'null') {
    dropoutRisk += 15;
    reasons.push("No valid email provided");
  }
  // Academic performance
  const subjects = ['english', 'marathi', 'hindi', 'social_science', 'science', 'maths'];
  let totalMarks = 0;
  let subjectCount = 0;
  let failedSubjects = 0;
  subjects.forEach(subject => {
    if (marks[subject] !== null && marks[subject] !== undefined) {
      const mark = parseFloat(marks[subject]);
      totalMarks += mark;
      subjectCount++;
      if (mark < 35) failedSubjects++;
    }
  });
  if (failedSubjects >= 3) {
    dropoutRisk += 30;
    reasons.push(`Failed ${failedSubjects} subjects`);
  } else if (failedSubjects >= 2) {
    dropoutRisk += 20;
    reasons.push(`Failed ${failedSubjects} subjects`);
  }
  const avgMarks = subjectCount > 0 ? totalMarks / subjectCount : 0;
  if (avgMarks > 0 && avgMarks < 40) {
    dropoutRisk += 25;
    reasons.push(`Low average: ${avgMarks.toFixed(1)}%`);
  } else if (avgMarks > 0 && avgMarks < 50) {
    dropoutRisk += 15;
    reasons.push(`Below average: ${avgMarks.toFixed(1)}%`);
  }
  return {
    willDropout: dropoutRisk >= 60,
    riskLevel: dropoutRisk >= 80 ? 'HIGH' : dropoutRisk >= 60 ? 'MEDIUM' : 'LOW',
    riskScore: Math.min(dropoutRisk, 100),
    reasons: reasons,
    recommendation: getRecommendation(dropoutRisk)
  };
}
 
// Analyze subjects
function analyzeSubjects(marks) {
  const analysis = {
    weakSubjects: [],
    strongSubjects: [],
    criticalSubjects: [],
    needsImprovement: [],
    recommendations: []
  };
  Object.entries(marks).forEach(([subject, score]) => {
    if (score === null || score === undefined) return;
    if (score < 35) {
      analysis.criticalSubjects.push({ subject, score });
      analysis.recommendations.push({
        subject: subject,
        message: `${subject.toUpperCase()}: CRITICAL - Score ${score}%. Immediate tutoring needed.`,
        priority: 1
      });
    } else if (score < 50) {
      analysis.needsImprovement.push({ subject, score });
      analysis.recommendations.push({
        subject: subject,
        message: `${subject.toUpperCase()}: Needs improvement - Score ${score}%. Practice 30 min daily.`,
        priority: 2
      });
    } else if (score < 60) {
      analysis.weakSubjects.push({ subject, score });
      analysis.recommendations.push({
        subject: subject,
        message: `${subject.toUpperCase()}: Average - Score ${score}%. Review weak topics.`,
        priority: 3
      });
    } else {
      analysis.strongSubjects.push({ subject, score });
    }
  });
  analysis.recommendations.sort((a, b) => a.priority - b.priority);
  return analysis;
}
 
// Helper functions
function getDaysSince(dateString) {
  if (!dateString) return 0;
  const date = new Date(dateString);
  const now = new Date();
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}
 
function getRecommendation(score) {
  if (score >= 70) {
    return "URGENT: Immediate intervention needed. Assign mentor and schedule counseling.";
  } else if (score >= 50) {
    return "MODERATE RISK: Follow up within 48 hours. Offer academic support.";
  } else {
    return "LOW RISK: Continue monitoring. Send encouraging messages.";
  }
}

// Generate final message using Ollama
async function generateFinalMessage(prediction, subjectAdvice) {
  const prompt = prediction.willDropout 
    ? `Student is at ${prediction.riskLevel} risk of dropping out.
Risk Score: ${prediction.riskScore}/100
Reasons: ${prediction.reasons.join(', ')}
 
Provide supportive, encouraging message about completing onboarding. Keep it 3-4 sentences.`
    : `Student will likely complete onboarding! Risk: ${prediction.riskLevel}
${subjectAdvice ? `Weak subjects: ${subjectAdvice.recommendations.map(r => r.subject).join(', ')}` : ''}
 
Congratulate them and provide specific study recommendations. Keep it encouraging and actionable in 4-5 sentences.`;
 
  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:1b',
        messages: [{ 
          role: 'user',  // Changed from 'system' to 'user'
          content: prompt 
        }],
        stream: false
      })
    });
    const data = await response.json();
    // Clean up the response
    let cleanMessage = data.message.content;
    cleanMessage = cleanMessage.replace(/<\|start_header_id\|>.*?<\|end_header_id\|>/g, '');
    cleanMessage = cleanMessage.replace(/\n+/g, ' ').trim();
    return cleanMessage || `Assessment complete. Risk Level: ${prediction.riskLevel}. ${prediction.recommendation}`;
  } catch (error) {
    console.error('Ollama error:', error);
    return `Assessment complete. Risk Level: ${prediction.riskLevel}. ${prediction.recommendation}`;
  }
}

const PORT = 9001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/marks.html in your browser`);
});