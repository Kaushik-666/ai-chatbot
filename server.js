const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
 
const app = express();
app.use(express.json());
app.use(express.static('public'));
 
// Mock database - All students have completed onboarding
const mockDatabase = {
  'STU001': {
    student_id: 'STU001',
    profile_completed: true,
    tutorial_completed: true,
    documents_submitted: true,
    preferences_set: true,
    current_step: 'completed',
    onboarding_started_at: '2024-01-15T10:00:00Z',
    onboarding_completed_at: '2024-01-16T14:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-25T09:00:00Z',
    email: 'student001@example.com'
  },
  'STU002': {
    student_id: 'STU002',
    profile_completed: true,
    tutorial_completed: true,
    documents_submitted: true,
    preferences_set: true,
    current_step: 'completed',
    onboarding_started_at: '2024-01-10T08:00:00Z',
    onboarding_completed_at: '2024-01-11T16:00:00Z',
    created_at: '2024-01-10T08:00:00Z',
    updated_at: '2024-01-26T11:00:00Z',
    email: 'student002@example.com'
  },
  'STU003': {
    student_id: 'STU003',
    profile_completed: true,
    tutorial_completed: true,
    documents_submitted: true,
    preferences_set: true,
    current_step: 'completed',
    onboarding_started_at: '2024-01-20T09:00:00Z',
    onboarding_completed_at: '2024-01-21T10:00:00Z',
    created_at: '2024-01-20T09:00:00Z',
    updated_at: '2024-01-27T15:00:00Z',
    email: 'student003@example.com'
  }
};
 
// Session storage
const sessions = {};
 
// Build 5 key questions
function buildQuestions(providedMarks) {
  const questions = [
    {
      id: 'study_hours',
      text: 'How many hours do you study per day on average?',
      type: 'number'
    },
    {
      id: 'attendance',
      text: 'What is your average class attendance percentage? (0-100)',
      type: 'number'
    },
    {
      id: 'support_system',
      text: 'Do you have access to tutoring or academic support when you need help? (yes/no)',
      type: 'yesno'
    },
    {
      id: 'motivation',
      text: 'On a scale of 1-10, how motivated do you feel about your studies?',
      type: 'number'
    },
    {
      id: 'challenges',
      text: 'What is your biggest challenge in your studies? (understanding concepts/time management/lack of resources/personal issues)',
      type: 'text'
    }
  ];
  return questions;
}
 
// Parse answer based on question type
function parseAnswer(message, question) {
  const lowerMessage = message.toLowerCase().trim();
  if (question.type === 'yesno') {
    if (lowerMessage.includes('yes') || lowerMessage.includes('y')) return true;
    if (lowerMessage.includes('no') || lowerMessage.includes('n')) return false;
    return null;
  }
  if (question.type === 'number') {
    const num = parseFloat(message);
    return isNaN(num) ? null : num;
  }
  if (question.type === 'text') {
    return message.trim();
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
          role: 'user',
          content: `Rephrase this question in a friendly, conversational way (1 sentence): "${question}"`
        }],
        stream: false
      })
    });
    const data = await response.json();
    let cleanMessage = data.message.content;
    cleanMessage = cleanMessage.replace(/<\|start_header_id\|>.*?<\|end_header_id\|>/g, '');
    cleanMessage = cleanMessage.replace(/\n+/g, ' ').trim();
    return cleanMessage || question;
  } catch (error) {
    console.error('Ollama error:', error);
    return question;
  }
}
 
// AI-generated prediction based on marks and answers
async function generateAIPrediction(marks, answers, conversationContext) {
  // Calculate average marks
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
  const avgMarks = subjectCount > 0 ? totalMarks / subjectCount : 0;
  // Build comprehensive prompt for AI
  const prompt = `You are an academic counselor analyzing student dropout risk.
 
STUDENT DATA:
- Average Marks: ${avgMarks.toFixed(1)}%
- Failed Subjects: ${failedSubjects} out of ${subjectCount}
- Study Hours per Day: ${answers.study_hours || 'Not provided'}
- Attendance: ${answers.attendance || 'Not provided'}%
- Has Support System: ${answers.support_system ? 'Yes' : 'No'}
- Motivation Level: ${answers.motivation || 'Not provided'}/10
- Biggest Challenge: ${answers.challenges || 'Not provided'}
 
CONVERSATION:
${conversationContext.messages.join('\n')}
 
TASK:
Analyze this student's dropout risk and provide a prediction.
 
Return ONLY valid JSON in this exact format (no extra text):
{
  "willDropout": true or false,
  "riskLevel": "HIGH" or "MEDIUM" or "LOW",
  "riskScore": number between 0-100,
  "reasons": ["reason1", "reason2", "reason3"],
  "recommendation": "detailed personalized recommendation (2-3 sentences)",
  "analysis": "brief analysis of key factors (1-2 sentences)"
}
 
GUIDELINES:
- HIGH risk (70-100): Multiple failing grades, low attendance, no support, low motivation
- MEDIUM risk (40-69): Some struggles but has support or motivation
- LOW risk (0-39): Good grades, regular attendance, motivated
- Be specific and actionable in recommendations
- Consider both academic and non-academic factors`;
 
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
    // Clean up response
    content = content.replace(/<\|start_header_id\|>.*?<\|end_header_id\|>/g, '');
    content = content.replace(/```json/g, '');
    content = content.replace(/```/g, '');
    content = content.trim();
    console.log('AI Response:', content);
    // Try to parse JSON
    try {
      const prediction = JSON.parse(content);
      // Validate and set defaults if needed
      return {
        willDropout: prediction.willDropout || false,
        riskLevel: prediction.riskLevel || 'MEDIUM',
        riskScore: prediction.riskScore || 50,
        reasons: Array.isArray(prediction.reasons) ? prediction.reasons : ['Unable to determine specific reasons'],
        recommendation: prediction.recommendation || 'Continue monitoring student progress.',
        analysis: prediction.analysis || 'Analysis unavailable'
      };
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // Fallback: Rule-based prediction
      return generateFallbackPrediction(avgMarks, failedSubjects, answers);
    }
  } catch (error) {
    console.error('AI prediction error:', error);
    return generateFallbackPrediction(avgMarks, failedSubjects, answers);
  }
}
 
// Fallback prediction if AI fails
function generateFallbackPrediction(avgMarks, failedSubjects, answers) {
  let score = 0;
  const reasons = [];
  // Academic factors
  if (failedSubjects >= 3) {
    score += 40;
    reasons.push(`Failed ${failedSubjects} subjects`);
  } else if (failedSubjects >= 2) {
    score += 25;
    reasons.push(`Failed ${failedSubjects} subjects`);
  }
  if (avgMarks < 40) {
    score += 30;
    reasons.push(`Low average: ${avgMarks.toFixed(1)}%`);
  } else if (avgMarks < 50) {
    score += 15;
    reasons.push(`Below average: ${avgMarks.toFixed(1)}%`);
  }
  // Study habits
  if (answers.study_hours && answers.study_hours < 2) {
    score += 15;
    reasons.push('Insufficient study time');
  }
  // Attendance
  if (answers.attendance && answers.attendance < 75) {
    score += 20;
    reasons.push(`Low attendance: ${answers.attendance}%`);
  }
  // Support system
  if (answers.support_system === false) {
    score += 15;
    reasons.push('No academic support system');
  }
  // Motivation
  if (answers.motivation && answers.motivation <= 5) {
    score += 20;
    reasons.push('Low motivation level');
  }
  const riskLevel = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  return {
    willDropout: score >= 70,
    riskLevel: riskLevel,
    riskScore: Math.min(score, 100),
    reasons: reasons.length > 0 ? reasons : ['No significant risk factors identified'],
    recommendation: getRecommendation(score),
    analysis: 'Prediction based on academic performance and engagement factors'
  };
}
// Get recommendation based on risk score
function getRecommendation(score) {
  if (score >= 70) {
    return "URGENT: Immediate intervention needed. Schedule one-on-one counseling, assign academic mentor, and create personalized study plan.";
  } else if (score >= 40) {
    return "MODERATE RISK: Provide additional support. Offer tutoring sessions, monitor progress weekly, and encourage participation in study groups.";
  } else {
    return "LOW RISK: Continue regular monitoring. Provide positive reinforcement and maintain open communication channels.";
  }
}
 
// Start chat session
app.post('/api/start-chat', async (req, res) => {
  const { studentId, providedMarks } = req.body;
  // Get student data (all have completed onboarding)
  const studentData = mockDatabase[studentId] || {
    student_id: studentId,
    profile_completed: true,
    tutorial_completed: true,
    documents_submitted: true,
    preferences_set: true,
    current_step: 'completed',
    onboarding_started_at: new Date().toISOString(),
    onboarding_completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    email: `${studentId.toLowerCase()}@example.com`
  };
  // Initialize session
  sessions[studentId] = {
    studentData: studentData,
    providedMarks: providedMarks || {},
    collectedMarks: { ...providedMarks } || {},
    answers: {},
    currentQuestion: 0,
    questions: [],
    conversationContext: { messages: [] }
  };
  // Build 5 questions
  const questions = buildQuestions(providedMarks || {});
  sessions[studentId].questions = questions;
  // Get first question
  if (questions.length > 0) {
    const firstQuestion = questions[0];
    const naturalQuestion = await makeQuestionNatural(firstQuestion.text);
    sessions[studentId].conversationContext.messages.push(`Bot: ${naturalQuestion}`);
    res.json({ message: naturalQuestion });
  } else {
    // No questions, predict immediately
    const prediction = await generateAIPrediction(
      providedMarks || {},
      {},
      sessions[studentId].conversationContext
    );
    res.json({
      completed: true,
      prediction: prediction,
      message: prediction.recommendation
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
  // Store user message
  session.conversationContext.messages.push(`User: ${message}`);
  // Parse and store answer
  const currentQuestion = session.questions[session.currentQuestion];
  const answer = parseAnswer(message, currentQuestion);
  session.answers[currentQuestion.id] = answer;
  console.log(`Question: ${currentQuestion.id}, Answer: ${answer}`);
  // Move to next question
  session.currentQuestion++;
  // Check if all questions answered
  if (session.currentQuestion >= session.questions.length) {
    console.log('All questions answered. Generating AI prediction...');
    console.log('Marks:', session.collectedMarks);
    console.log('Answers:', session.answers);
    // Generate AI prediction
    const prediction = await generateAIPrediction(
      session.collectedMarks,
      session.answers,
      session.conversationContext
    );
    console.log('Prediction:', prediction);
    return res.json({
      completed: true,
      prediction: prediction,
      message: `${prediction.analysis}\n\n${prediction.recommendation}`
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
 
// Start server
const PORT = 9001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/marks.html in your browser`);
});