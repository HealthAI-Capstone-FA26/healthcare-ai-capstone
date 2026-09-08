export interface AiLabAnalysisInput {
    labResultId: string;
    imageUrl: string;
}

export interface AiLabAnalysisOutput {
    modelName: string;
    modelVersion?: string;
    isAnomaly: boolean;
    finding: string;
    confidenceScore: number;
}

export const AI_LAB_ANALYSIS_PROVIDER = 'AI_LAB_ANALYSIS_PROVIDER';

export interface AiLabAnalysisProvider {
    analyze(input: AiLabAnalysisInput): Promise<AiLabAnalysisOutput>;
}
