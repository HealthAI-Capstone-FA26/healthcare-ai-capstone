import { PartialType } from '@nestjs/mapped-types';
import { CreateImagingStudyDto } from './create-imaging-study.dto';

export class UpdateImagingStudyDto extends PartialType(CreateImagingStudyDto) {}
