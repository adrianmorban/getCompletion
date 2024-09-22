import OpenAI from 'openai';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
  
const lambdaClient = new LambdaClient({ region: 'us-east-1' });

const now = new Date();

const formattedDate = now.toISOString().split('T')[0];

const formattedTime = now.toTimeString().split(' ')[0].slice(0, 5);

const setAppointmentCalling = {
    type: "function",
    function: {
        name: "set_appointment",
        description: "Set the appoinment for the client. Call this everytime you know the client wants to set an appoinment, for example when a customer says 'I want to set an appoinment'.",
        parameters: {
            type: "object",
            properties: {
                day: {
                    type: "string",
                    description: "The day of the appoinment in the format YYYY-MM-DD, if the today is greater than the day of the appoinment, the appoinment will be set for the next day.",
                },
                hour: {
                    type: "string",
                    description: "The hour of the appoinment in the format HH:MM.",
                },
                fullName: {
                    type: "string",
                    description: "The full name of the client.",
                },
                cedula: {
                    type: "string",
                    description: "The cedula of the client, it must be a string in the format xxx-xxxxxxx-x where x is a number",
                }
            },
            required: ["day", "hour", "fullName", "cedula"],
        }
    }
}

export const getCompletion = async (event) => {

  if(!event.SessionData || !event.OriginalInput){
    console.log('SessionData or OriginalInput is missing');
    throw new Error('SessionData or OriginalInput is missing');
  }

  const message = event.OriginalInput.text || "Mensaje de prueba";
  
  const sessionData = event.SessionData.result || {};

  const { messages } = sessionData || [];

  messages.push({
    role: 'user',
    content: `${message} {${formattedDate} - ${formattedTime}}`
  });

  const completion = await client.chat.completions.create({
    model: 'ft:gpt-4o-2024-08-06:personal:sally:A8t20vlA',
    messages: messages,
    tools: [setAppointmentCalling],
    tool_choice: "auto",
  });

  if(completion.choices[0].message.tool_calls && completion.choices[0].message.tool_calls[0].function.name === 'set_appointment'){
    const {day, hour, fullName, cedula} = JSON.parse(completion.choices[0].message.tool_calls[0].function.arguments);

    const cedulaPattern = /^\d{3}-?\d{7}-?\d{1}$/;

    messages.push({
      role: 'system',
      content: `Función llamada: set_appointment con los argumentos: ${JSON.stringify({ day, hour, fullName, cedula })}`
    });

    if (!cedulaPattern.test(cedula)) {
      messages.push({
        role: 'system', 
        content: 'La cédula proporcionada no es válida. Asegúrate de que esté en el formato xxx-xxxxxxx-x.'
      });
      return messages;
    }

    let appoinmentDateTime = new Date(`${day}T${hour}:00`);
    let currentDateTime = new Date(`${formattedDate}T${formattedTime}:00`);

    if(appoinmentDateTime < currentDateTime){
      messages.push({
        role: 'system', 
        content: 'Lo siento, no puedo agendar una cita para una hora que ya pasó.'
      });
      return messages;
    }

    if(appoinmentDateTime - currentDateTime < 3600000){
      messages.push({
        role: 'system', 
        content: 'Lo siento, no puedo agendar una cita para dentro de una hora.'
      });
      return messages;
    }

    const result = await lambdaClient.send(new InvokeCommand({
      FunctionName: 'setAppointment',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({ day, hour, fullName, cedula })
    }));

    messages.push({
      role: 'system', 
      content: `Resultado de la función setAppointment: ${JSON.stringify(result.Payload)}`
    });

    return messages;

    if(result.StatusCode === 200){
      messages.push({
        role: 'system', 
        content: `Cita agendada para el día ${day} a las ${hour} a nombre de ${fullName} con cédula ${cedula}`
      });
      return messages;
    }
    else{
      messages.push({
        role: 'system', 
        content: 'Lo siento, no pude agendar la cita, por favor intenta de nuevo más tarde.'
      });
      return messages;
    }
  }
  else{
    messages.push({
      role: 'system',
      content: completion.choices[0].message.content
    });
    return messages;
  }
};